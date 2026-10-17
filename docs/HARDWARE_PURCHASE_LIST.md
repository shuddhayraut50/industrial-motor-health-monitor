# Industrial Motor Health Monitor — Components & Jumper-Wire Purchase List

This document provides an exhaustive, vetted Bill of Materials (BOM) for completing the physical wiring and bench assembly of the Industrial Motor Health Monitor.

---

## 1. Summary of Requirements & Status

| Category | Essential Now | Optional / Enhancement |
|---|---|---|
| **Microcontroller & Sensors** | ESP32-S3 DevKit, ADXL345, 1x DS18B20 (Motor) | 2nd DS18B20 (Ambient), DS3231 RTC Module |
| **Offline Storage** | MicroSD SPI Breakout Module + 16GB/32GB Card | — (Internal LittleFS flash fallback functions without SD) |
| **Diagnostics & Indicators**| 5x 5mm LEDs (Test) + 2x LEDs (Red/Green Status) | Industrial 24V Stack Light / Optocouplers |
| **Passives & Wiring** | 7x 330Ω Resistors, 2x 4.7kΩ Resistors, Jumper Wires | Solderable Protoboard / Terminal Blocks |

---

## 2. Itemized Hardware Bill of Materials

### 2.1 Essential Components (Required for Current Milestone)

| Component Name | Description & Purpose | Qty | Availability Status | Electrical Specs & Compatibility | Necessity |
|---|---|:---:|:---:|---|:---:|
| **ESP32-S3 DevKitC-1 N16R8** | Microcontroller: dual-core 240MHz, 16MB Flash, 8MB PSRAM. Primary calculation engine. | 1 | **Available** (In use) | Powered via USB 5V or external 5V VIN. All GPIO logic is 3.3V only. | **Essential** |
| **ADXL345 Accelerometer** | 3-axis digital accelerometer for 200 Hz continuous motor vibration sampling. | 1 | **Available** (In use) | 3.3V VDD, I2C address 0x53. (CS pulled to 3.3V, SDO to GND). | **Essential** |
| **DS18B20 Temperature Probe (Motor)** | Waterproof stainless steel probe for direct motor stator/casing temperature monitoring. | 1 | **Available** (In use) | 3.0V to 5.5V (Use 3.3V). Dedicated OneWire bus on GPIO 10. | **Essential** |
| **$4.7\,\text{k}\Omega$ Metal Film Resistors** | OneWire pull-up resistor (Data line to 3.3V). | 2 | **Required** (Check parts box) | $1/4\text{W}$, $\pm 1\%$ tolerance. Essential for reliable DS18B20 bus operation. | **Essential** |
| **5mm LEDs (Assorted Colors)** | 5x Test LEDs for vibration level & remote command testing (GPIO 4, 5, 6, 7, 16). | 5 | **Required** (To purchase) | Standard $20\text{ mA}$ indicator LEDs (Blue, Yellow, Green, or Amber). Active-HIGH. | **Essential** |
| **5mm Red & Green Status LEDs** | High-visibility status indicators: Green (Healthy/Online), Red (Critical/Fault). | 2 | **Required** (To purchase) | Standard $20\text{ mA}$ indicator LEDs. Active-HIGH (GPIO 17 & 18). | **Essential** |
| **$330\,\Omega$ Metal Film Resistors** | Current-limiting resistors for all 7 LEDs (limits current to $\sim 4.5\text{ mA}$ per GPIO). | 7 | **Required** (To purchase) | $1/4\text{W}$, $\pm 5\%$. Mandatory to prevent GPIO overcurrent damage. | **Essential** |
| **Solderless Breadboard** | 830-tie point breadboard for modular circuit assembly and test probing. | 1 | **Required** (If not owned) | Standard 2.54mm pitch breadboard with dual power distribution rails. | **Essential** |
| **Jumper Wires (M-M, M-F, F-F)** | Multi-colored flexible jumper wires for breadboard and sensor breakout interconnects. | 1 pack (120 pcs) | **Required** (To purchase) | See detailed breakdown in Section 3 below. | **Essential** |

---

### 2.2 Highly Recommended & Optional Components

| Component Name | Description & Purpose | Qty | Availability Status | Electrical Specs & Compatibility | Necessity |
|---|---|:---:|:---:|---|:---:|
| **MicroSD SPI Breakout Board** | Push-push MicroSD card socket with SPI breakout pins for primary offline storage. | 1 | **Required** (To purchase) | **Must be 3.3V logic compatible**. Avoid modules without level shifters if using 5V VIN. | **Recommended** (Flash fallback works if omitted) |
| **SanDisk / Kingston 16GB or 32GB MicroSD Card** | High-endurance Class 10 / UHS-I MicroSD card for continuous ring logging. | 1 | **Required** (To purchase) | **Must be formatted as FAT32**. Do not use $>32\text{GB}$ (SDXC/exFAT). | **Recommended** |
| **DS18B20 Temperature Probe (Ambient)** | Second waterproof probe for ambient air temperature to compute true thermal rise ($\Delta T$). | 1 | **Required** (To purchase) | 3.3V supply, dedicated OneWire bus on GPIO 11 with $4.7\,\text{k}\Omega$ pull-up. | **Recommended** (Firmware supports single probe) |
| **DS3231SN Precision RTC Module** | High-precision I2C Real-Time Clock with battery backup for offline wall-clock timestamps. | 1 | **Required** (To purchase) | 3.3V VDD, I2C address 0x68. Shared I2C bus with ADXL345 on GPIO 8/9. | **Optional** (NTP time used when Wi-Fi is up) |
| **CR2032 Lithium Coin Battery** | 3V backup coin cell for DS3231 RTC timekeeping during power-off. | 1 | **Required** (To purchase) | 3V nominal. Ensure RTC module charging circuit is disabled for non-rechargeable CR2032. | **Optional** (If RTC purchased) |
| **$100\,\mu\text{F}$ to $470\,\mu\text{F}$ Electrolytic Capacitor** | Power rail decoupling buffer across 5V/GND to suppress Wi-Fi transmit current spikes. | 2 | **Recommended** (In kit) | 16V or 25V rated electrolytic capacitor. | **Recommended** |

---

## 3. Jumper-Wire Breakdown & Specifications

When purchasing jumper wires, obtain a multi-pack containing **all three gender configurations** with standard 2.54mm Dupont connectors:

1. **Male-to-Female (M-F) — Qty: 40 pieces (20cm length):**
   - **Why needed:** Connects male breadboard pins or ESP32 dev board headers to female headers on sensor breakouts (ADXL345, DS3231, MicroSD socket).
   - Expected usage:
     - ADXL345: 5 wires (3.3V, GND, SDA, SCL, CS)
     - MicroSD Module: 6 wires (3.3V, GND, MOSI, MISO, SCK, CS)
     - DS3231 RTC: 4 wires (3.3V, GND, SDA, SCL)
2. **Male-to-Male (M-M) — Qty: 40 pieces (10cm to 15cm length):**
   - **Why needed:** Interconnects between ESP32 pins, breadboard tie points, resistors, and LEDs.
   - Expected usage:
     - 7x LED anode pins from ESP32 GPIO to breadboard resistors
     - 7x LED cathode tie points to breadboard Common Ground rail
     - Pull-up resistors from 3.3V rail to OneWire GPIO lines
3. **Female-to-Female (F-F) — Qty: 20 pieces (20cm length):**
   - **Why needed:** Useful for connecting male pin headers directly between modules or scope test points.

---

## 4. What Must Be Physically Verified Before Wiring

Before applying power to your wired assembly:

1. **Verify MicroSD Module Supply Voltage:**
   - Some cheap MicroSD breakout boards contain an AMS1117-3.3 regulator and require 5V input on their VCC pin.
   - Other boards are strictly 3.3V and will be damaged if connected to 5V.
   - Check whether your board has an onboard 5-pin or 3-pin regulator IC before deciding whether to wire VCC to ESP32 5V or 3.3V.
2. **DS18B20 Wire Color Code:**
   - Standard probe wiring:
     - **Red:** $V_{\text{DD}}$ (Connect to 3.3V)
     - **Black:** GND (Connect to Common Ground)
     - **Yellow or Blue:** DATA (Connect to GPIO 10 or 11 with $4.7\,\text{k}\Omega$ pull-up)
   - Some counterfeit probes use different internal colors. Always verify resistance between ground and VDD if in doubt.
3. **LED Polarity & Resistor Placement:**
   - Long leg (Anode) must always connect in series with the $330\,\Omega$ resistor to the GPIO pin.
   - Short leg (Cathode / flat notch) must connect directly to GND.
   - **Never connect an LED directly between GPIO and GND without a series resistor.**
