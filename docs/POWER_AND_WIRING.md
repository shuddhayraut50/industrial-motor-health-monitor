# POWER DISTRIBUTION, ELECTRICAL SAFETY & WIRING GUIDE
**Industrial Motor Health Monitor — ESP32-S3, MicroSD, ADXL345, Dual DS18B20s, DS3231 RTC**

---

## 1. Power Architecture Overview

Industrial motor environments present severe electrical challenges: motor inductive kickback, ground potential shifts, and EMI. The ESP32-S3 and its high-current peripherals (MicroSD card writes: up to 100–150 mA peak; Wi-Fi TX: up to 240–350 mA peak) must be supplied with a stable, low-noise power rail.

```
       +------------------------------------+
       | External Regulated 5V, 2A Supply  |
       +-----------------+------------------+
                         |
           +-------------+-------------+
           | 5V Rails                  | GND (Common Ground)
           v                           v
     +------------+              +------------+
     | ESP32-S3   |              | MicroSD    |
     | DevKit VIN |              | SPI Module |
     +-----+------+              | (5V VIN)   |
           |                     +-----+------+
    Onboard 3.3V LDO                   | Onboard LDO + Level Shifter
           v                           v
     +-----+--------------------+   +--+------------------------+
     | 3.3V Clean Rail          |   | 3.3V MicroSD Card Core    |
     | - ADXL345 (I2C)          |   +---------------------------+
     | - DS3231 RTC (I2C)       |
     | - DS18B20 Motor (1-Wire) |
     | - DS18B20 Amb (1-Wire)   |
     +--------------------------+
```

---

## 2. Power Rail Specifications & Safety Boundaries

| Rail / Pin | Nominal Voltage | Acceptable Range | Max Current Draw | Connected Devices |
| :--- | :--- | :--- | :--- | :--- |
| **External 5V / VIN** | +5.00 V | +4.80 V to +5.25 V | Up to 2000 mA | ESP32-S3 DevKit `VIN` pin & MicroSD Module `5V` pin |
| **ESP32 Onboard 3.3V** | +3.30 V | +3.20 V to +3.40 V | Up to 500 mA (LDO limited) | ADXL345 (0x53), DS3231 RTC (0x68), Dual DS18B20s |
| **MicroSD SPI Core** | +3.30 V | +3.15 V to +3.45 V | Up to 150 mA (Peak Write) | MicroSD card socket (powered via module's internal LDO) |
| **GPIO Logic Signals** | +3.30 V | 0.0 V to +3.30 V | Max 12 mA per pin | All digital I/O lines (I2C, SPI, 1-Wire, LEDs) |

> [!CAUTION]
> **NEVER apply 5.0V directly to the ESP32-S3 3.3V pin or any GPIO pin.** The ESP32-S3 I/O buffers are strictly NOT 5V tolerant. Exceeding 3.6V on any GPIO will permanently destroy the microcontroller silicon.

> [!IMPORTANT]
> **USB Programming & External 5V Coexistence**:
> Most standard ESP32-S3 DevKit boards include an onboard Schottky diode (e.g. B5819W / MBRA140) between the USB VBUS (+5V) and the VIN rail to prevent back-powering your computer USB port.
> However, for absolute safety when programming via USB:
> 1. Either disconnect the external 5V power wire while the USB data cable is actively programming the board; OR
> 2. Confirm your development board features an integrated power-path management IC (e.g. TPS2113A) or dual Schottky isolation.

---

## 3. MicroSD Voltage Drop Diagnosis & Resolution

### Root Cause of the Initial Voltage Drop
1. **Physical Pin Short (GPIO 14 MOSI to GND)**:
   - Probing revealed that GPIO 14 (MOSI) was shorted directly to Ground on the breadboard rail. When the ESP32 attempted to drive the MOSI line high during SPI bus transactions, high shoot-through current was shunted to ground, pulling down the local voltage rail.
   - Moving the jumper wire off ground restored high impedance (`PU=1, PD=0`).
2. **SD Module Power Rail Selection**:
   - Standard MicroSD modules feature an onboard 3.3V regulator (such as an AMS1117-3.3 or XC6206) and a 74LVC125A or resistor-divider level shifter.
   - Connecting the module's 5V input to external regulated 5V (rather than overloading the ESP32's internal 3.3V pin) isolates the large 100–150 mA write current surges from the sensitive analog/I2C sensors (ADXL345 and DS3231).

---

## 4. Hardware Pin Mapping Table

| Peripheral | Signal / Function | ESP32-S3 Pin | Voltage Level | Wiring Rules & Pull-Ups |
| :--- | :--- | :--- | :--- | :--- |
| **ADXL345 & DS3231** | I2C SDA | **GPIO 8** | 3.3V | Shared I2C bus; 4.7 kΩ pull-up to 3.3V |
| **ADXL345 & DS3231** | I2C SCL | **GPIO 9** | 3.3V | Shared I2C bus; 4.7 kΩ pull-up to 3.3V |
| **Motor DS18B20** | 1-Wire Data | **GPIO 10** | 3.3V | Dedicated 1-Wire bus; 4.7 kΩ pull-up to 3.3V |
| **Ambient DS18B20**| 1-Wire Data | **GPIO 11** | 3.3V | Dedicated 1-Wire bus; 4.7 kΩ pull-up to 3.3V |
| **MicroSD Module** | SPI SCK | **GPIO 12** | 3.3V | Dedicated FSPI / SPI2 clock |
| **MicroSD Module** | SPI MISO | **GPIO 13** | 3.3V | SPI Master-In Slave-Out (Data Out) |
| **MicroSD Module** | SPI MOSI | **GPIO 14** | 3.3V | SPI Master-Out Slave-In (Data In) |
| **MicroSD Module** | SPI CS | **GPIO 15** | 3.3V | Active LOW Chip Select; 10 kΩ pull-up to 3.3V |
| **Red Status LED** | Critical / Fault | **GPIO 17** | 3.3V | Active HIGH; series 220 Ω to 330 Ω resistor to GND |
| **Green Status LED**| Normal / Ingest | **GPIO 18** | 3.3V | Active HIGH; series 220 Ω to 330 Ω resistor to GND |
| **Test LED Array** | LEDs 1, 2, 3, 4 | **GPIO 4, 5, 6, 7** | 3.3V | Active HIGH; series 220 Ω to 330 Ω resistor to GND |
| **Test LED 5** | Unpopulated | **GPIO 16** | 3.3V | Reserved on bench; held LOW by firmware |

---

## 5. Physical Multimeter Measurement Points & Procedure

To verify voltage stability under real operational loads, measure at these specific test points using a calibrated digital multimeter:

```
               [TP1: External 5V Supply Rail]
                             |
                   +---------+---------+
                   |                   |
    [TP2: DevKit 5V/VIN Pin]     [TP3: SD Module 5V Input]
                   |                   |
        (ESP32 Onboard LDO)     (SD Module Onboard LDO)
                   |                   |
    [TP4: DevKit 3.3V Rail]      [TP5: SD Card 3.3V VDD]
```

### Test Procedure:
1. **Idle State (TP1 to GND)**:
   - Measure external 5V supply output before connecting to breadboard.
   - *Expected*: 5.00 V – 5.15 V.
2. **Operational Load (TP2 to GND)**:
   - Measure while Wi-Fi is actively uploading telemetry to Vercel.
   - *Expected*: 4.90 V – 5.10 V (maximum allowable droop is 0.20 V).
3. **SD Write Surge (TP4 and TP5 to GND)**:
   - Measure 3.3V rail during SD card write bursts (flush of `/telemetry.csv`).
   - *Expected*: 3.25 V – 3.35 V. If TP4 dips below 3.05 V, an `ESP_RST_BROWNOUT` event will be triggered.
