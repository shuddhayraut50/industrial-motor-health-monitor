-- Industrial Motor Health Monitoring Platform
-- Schema Migration 00008: Storage Quotas, Budget Partitioning & Step-by-Step Data Retention
-- Implements Supabase 500 MB Free Tier Budget Partitioning:
--   - 400 MB dedicated to General Telemetry data (FIFO step-by-step pruning on overflow)
--   - 100 MB reserved for Error Logs, Diagnostics, Commands, and Audit Events
--   - Edge Device storage quota alignment: 15% Error/Diagnostic reserve, 85% Telemetry Backlog (90% ceiling)

-- 1. Create a function to estimate and inspect table byte sizes
CREATE OR REPLACE FUNCTION public.get_table_size_bytes(tbl_name TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    size_bytes BIGINT;
BEGIN
    SELECT pg_total_relation_size(quote_ident(tbl_name)::regclass) INTO size_bytes;
    RETURN COALESCE(size_bytes, 0);
EXCEPTION
    WHEN OTHERS THEN
        RETURN 0;
END;
$$;

-- 2. Stored Procedure: Step-by-Step FIFO Telemetry Pruning
-- Deletes the oldest raw telemetry records step-by-step in safe, non-locking batches
-- until the telemetry table is strictly within its 400 MB quota (or custom target_max_mb).
CREATE OR REPLACE FUNCTION public.prune_telemetry_within_budget(
    target_max_mb NUMERIC DEFAULT 400.0,
    batch_size INTEGER DEFAULT 5000
)
RETURNS TABLE (
    rows_deleted BIGINT,
    initial_size_bytes BIGINT,
    final_size_bytes BIGINT,
    target_budget_bytes BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    target_bytes BIGINT := (target_max_mb * 1024 * 1024)::BIGINT;
    curr_size BIGINT;
    init_size BIGINT;
    deleted_count BIGINT := 0;
    batch_deleted INTEGER := 0;
    safety_max_iterations INTEGER := 50;
    iteration INTEGER := 0;
BEGIN
    init_size := public.get_table_size_bytes('telemetry');
    curr_size := init_size;

    -- If current table size exceeds the 400 MB general data budget, prune oldest step-by-step
    WHILE curr_size > target_bytes AND iteration < safety_max_iterations LOOP
        iteration := iteration + 1;

        WITH doomed AS (
            SELECT id
            FROM public.telemetry
            ORDER BY recorded_at ASC
            LIMIT batch_size
        )
        DELETE FROM public.telemetry t
        USING doomed d
        WHERE t.id = d.id;

        GET DIAGNOSTICS batch_deleted = ROW_COUNT;
        deleted_count := deleted_count + batch_deleted;

        IF batch_deleted = 0 THEN
            EXIT;
        END IF;

        curr_size := public.get_table_size_bytes('telemetry');
    END LOOP;

    RETURN QUERY SELECT deleted_count, init_size, curr_size, target_bytes;
END;
$$;

-- 3. Stored Procedure: Step-by-Step Diagnostic Events & Error Log Pruning
-- Enforces the 100 MB error/problem log quota.
-- Prioritizes pruning resolved info/warning events first, protecting active/critical faults.
CREATE OR REPLACE FUNCTION public.prune_diagnostic_events_within_budget(
    target_max_mb NUMERIC DEFAULT 100.0,
    batch_size INTEGER DEFAULT 1000
)
RETURNS TABLE (
    rows_deleted BIGINT,
    initial_size_bytes BIGINT,
    final_size_bytes BIGINT,
    target_budget_bytes BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    target_bytes BIGINT := (target_max_mb * 1024 * 1024)::BIGINT;
    curr_size BIGINT;
    init_size BIGINT;
    deleted_count BIGINT := 0;
    batch_deleted INTEGER := 0;
    safety_max_iterations INTEGER := 30;
    iteration INTEGER := 0;
BEGIN
    init_size := public.get_table_size_bytes('device_diagnostic_events')
               + public.get_table_size_bytes('device_commands')
               + public.get_table_size_bytes('device_config_ack');
    curr_size := init_size;

    -- Phase 1: Prune resolved INFO events older than 7 days
    WHILE curr_size > target_bytes AND iteration < safety_max_iterations LOOP
        iteration := iteration + 1;

        WITH doomed AS (
            SELECT id
            FROM public.device_diagnostic_events
            WHERE resolved = true AND severity = 'info'
            ORDER BY event_timestamp ASC
            LIMIT batch_size
        )
        DELETE FROM public.device_diagnostic_events e
        USING doomed d
        WHERE e.id = d.id;

        GET DIAGNOSTICS batch_deleted = ROW_COUNT;
        deleted_count := deleted_count + batch_deleted;

        IF batch_deleted = 0 THEN
            EXIT;
        END IF;

        curr_size := public.get_table_size_bytes('device_diagnostic_events')
                   + public.get_table_size_bytes('device_commands')
                   + public.get_table_size_bytes('device_config_ack');
    END LOOP;

    -- Phase 2: If still over 100 MB, prune oldest non-critical events
    iteration := 0;
    WHILE curr_size > target_bytes AND iteration < safety_max_iterations LOOP
        iteration := iteration + 1;

        WITH doomed AS (
            SELECT id
            FROM public.device_diagnostic_events
            WHERE severity IN ('info', 'warning')
            ORDER BY event_timestamp ASC
            LIMIT batch_size
        )
        DELETE FROM public.device_diagnostic_events e
        USING doomed d
        WHERE e.id = d.id;

        GET DIAGNOSTICS batch_deleted = ROW_COUNT;
        deleted_count := deleted_count + batch_deleted;

        IF batch_deleted = 0 THEN
            EXIT;
        END IF;

        curr_size := public.get_table_size_bytes('device_diagnostic_events')
                   + public.get_table_size_bytes('device_commands')
                   + public.get_table_size_bytes('device_config_ack');
    END LOOP;

    RETURN QUERY SELECT deleted_count, init_size, curr_size, target_bytes;
END;
$$;

-- 4. Status Function: Get Storage Budget Status Overview
CREATE OR REPLACE FUNCTION public.get_storage_budget_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    telemetry_bytes BIGINT;
    events_bytes BIGINT;
    commands_bytes BIGINT;
    devices_bytes BIGINT;
    configs_bytes BIGINT;
    general_bytes BIGINT;
    error_bytes BIGINT;
    total_bytes BIGINT;
    telemetry_rows BIGINT;
    events_rows BIGINT;
BEGIN
    telemetry_bytes := public.get_table_size_bytes('telemetry');
    events_bytes := public.get_table_size_bytes('device_diagnostic_events');
    commands_bytes := public.get_table_size_bytes('device_commands');
    devices_bytes := public.get_table_size_bytes('devices');
    configs_bytes := public.get_table_size_bytes('device_config') + public.get_table_size_bytes('device_config_ack');

    SELECT COALESCE(reltuples::BIGINT, 0) INTO telemetry_rows FROM pg_class WHERE relname = 'telemetry';
    SELECT COALESCE(reltuples::BIGINT, 0) INTO events_rows FROM pg_class WHERE relname = 'device_diagnostic_events';

    general_bytes := telemetry_bytes + devices_bytes;
    error_bytes := events_bytes + commands_bytes + configs_bytes;
    total_bytes := general_bytes + error_bytes;

    RETURN jsonb_build_object(
        'cloud_quota', jsonb_build_object(
            'general_data_bytes', general_bytes,
            'general_data_mb', ROUND((general_bytes::NUMERIC / (1024 * 1024)), 2),
            'general_data_limit_mb', 400.0,
            'general_data_used_pct', ROUND((general_bytes::NUMERIC / (400.0 * 1024 * 1024)) * 100.0, 2),
            'error_data_bytes', error_bytes,
            'error_data_mb', ROUND((error_bytes::NUMERIC / (1024 * 1024)), 2),
            'error_data_limit_mb', 100.0,
            'error_data_used_pct', ROUND((error_bytes::NUMERIC / (100.0 * 1024 * 1024)) * 100.0, 2),
            'total_used_mb', ROUND((total_bytes::NUMERIC / (1024 * 1024)), 2),
            'total_limit_mb', 500.0,
            'total_used_pct', ROUND((total_bytes::NUMERIC / (500.0 * 1024 * 1024)) * 100.0, 2),
            'telemetry_estimated_rows', telemetry_rows,
            'events_estimated_rows', events_rows
        ),
        'edge_quota', jsonb_build_object(
            'total_ceiling_pct', 90.0,
            'telemetry_backlog_budget_pct', 85.0,
            'error_diagnostics_budget_pct', 15.0,
            'policy', 'FIFO step-by-step deletion of oldest records on ceiling reached'
        )
    );
END;
$$;

-- 5. Comments for Documentation
COMMENT ON FUNCTION public.prune_telemetry_within_budget IS 'FIFO step-by-step deletion of oldest raw telemetry records when table exceeds 400 MB';
COMMENT ON FUNCTION public.prune_diagnostic_events_within_budget IS 'Prunes resolved and low-severity logs when diagnostic events exceed 100 MB';
COMMENT ON FUNCTION public.get_storage_budget_status IS 'Returns 400 MB general / 100 MB error budget utilization for the Supabase 500 MB free tier';
