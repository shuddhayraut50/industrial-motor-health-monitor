-- Industrial Motor Health Monitoring Platform
-- Schema Migration 00007: Device Diagnostic Events Table & Status Tracking
-- Provisions event-based diagnostic logging for independent edge components.

CREATE TABLE IF NOT EXISTS public.device_diagnostic_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL REFERENCES public.devices(device_id) ON DELETE CASCADE,
    component TEXT NOT NULL CHECK (component IN ('esp32', 'wifi', 'api', 'adxl345', 'motor_temp', 'ambient_temp', 'sd_card', 'rtc', 'classifier', 'command')),
    event_code TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    previous_state TEXT,
    new_state TEXT NOT NULL,
    event_timestamp TIMESTAMPTZ NOT NULL,
    timestamp_source TEXT NOT NULL DEFAULT 'system' CHECK (timestamp_source IN ('rtc', 'ntp', 'system')),
    diagnostic_message TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    firmware_version TEXT,
    resolved BOOLEAN NOT NULL DEFAULT false,
    server_received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexing for rapid timeline queries, component filtering, and severity aggregation
CREATE INDEX IF NOT EXISTS idx_device_events_device_time ON public.device_diagnostic_events (device_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_device_events_component ON public.device_diagnostic_events (device_id, component, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_device_events_severity ON public.device_diagnostic_events (device_id, severity, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_device_events_unresolved ON public.device_diagnostic_events (device_id, resolved) WHERE resolved = false;

-- Enable Row Level Security (RLS)
ALTER TABLE public.device_diagnostic_events ENABLE ROW LEVEL SECURITY;

-- Allow reading diagnostic events by authenticated users or public service
CREATE POLICY "Allow read access to diagnostic events"
    ON public.device_diagnostic_events FOR SELECT
    USING (true);

-- Allow inserting diagnostic events by service role or authenticated backend
CREATE POLICY "Allow insert access to diagnostic events"
    ON public.device_diagnostic_events FOR INSERT
    WITH CHECK (true);

COMMENT ON TABLE public.device_diagnostic_events IS 'Event-based state transitions and fault logs for independent edge components';
COMMENT ON COLUMN public.device_diagnostic_events.component IS 'Physical or logical subsystem: esp32, wifi, api, adxl345, motor_temp, ambient_temp, sd_card, rtc, classifier, command';
COMMENT ON COLUMN public.device_diagnostic_events.event_code IS 'Machine-readable event identifier e.g. WIFI_DISCONNECTED, SD_CARD_MISSING, ADXL345_RECOVERED';
COMMENT ON COLUMN public.device_diagnostic_events.resolved IS 'Whether an active fault condition has since cleared';
