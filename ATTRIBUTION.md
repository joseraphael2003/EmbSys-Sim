# Third-Party Asset Attributions and Licenses

This repository vendors vector graphic assets for virtual board profiles in the Mbed Simulator. Each asset is listed below with its authoritative upstream source, applicable license, and SHA-256 checksum.

---

## 1. Raspberry Pi Pico Breadboard Vector Graphic

- **File**: `viewer/img/controller_pico.svg`
- **Component**: Raspberry Pi Pico (RP2040) virtual board breadboard drawing
- **Source**: Raspberry Pi Ltd official hardware design files for Raspberry Pi Pico (Revision 3 / Pico-R3).
  - Upstream package: `RP-008310-DS-1-Pico-R3-Fritzing.zip` (containing `Pico-R3-Fritzing.fzpz`)
  - Source URL: `https://pip.raspberrypi.com/categories/610-raspberry-pi-pico` / `https://pip-assets.raspberrypi.com/categories/610-raspberry-pi-pico/documents/RP-008310-DS-1-Pico-R3-Fritzing.zip`
  - Extracted member: `svg.breadboard.rpi_pico-tht_1_breadboard.svg` (authors: Alasdair Allan / Jack Wills, modified by vanepp)
- **Modifications**: Added element `id="led1"` to the GP25 onboard LED ellipse (`circle222`, `cx="179.77859" cy="256.97235"`) and set default off-state fill (`fill="black"`).
- **License**: Creative Commons Attribution-ShareAlike 4.0 International (CC-BY-SA 4.0) / Raspberry Pi Ltd hardware design files terms.
  - Copyright (c) 2020-2026 Raspberry Pi Ltd.
  - License terms: https://creativecommons.org/licenses/by-sa/4.0/
- **SHA-256 Checksum** (`viewer/img/controller_pico.svg`):
  `b9318dfd9224b990779e0f38911f2c9aa1123a3e63487ef689bbb30d9a7200ab`

---

## 2. STM32 Nucleo Board Breadboard Vector Graphic

- **File**: `viewer/img/controller_nucleo.svg`
- **Component**: STMicroelectronics Nucleo-64 (STM32F401RE) virtual board breadboard drawing
- **Source**: Fritzing open source parts repository (`fritzing-parts` core library).
  - Source URL: `https://raw.githubusercontent.com/fritzing/fritzing-parts/master/svg/core/breadboard/STM32_Nucleo_board_breadboard.svg`
  - Upstream author: Fabian Althaus (Fritzing core team)
- **Modifications**: Added user LED LD2 (green LED, connected to PA_5 / D13) at `x="123.32" y="44.0"` with `id="led1"` and silk text `LD2`, and stamped `id="button1"` onto user button B1 (blue push button, connected to PC_13) at `cx="78.431" cy="117.602"`.
- **License**: Creative Commons Attribution-ShareAlike 3.0 Unported (CC-BY-SA 3.0)
  - Copyright (c) Fritzing project (Friends-of-Fritzing e.V. and contributors).
  - License terms: http://creativecommons.org/licenses/by-sa/3.0/
- **SHA-256 Checksum** (`viewer/img/controller_nucleo.svg`):
  `6297b60aa598812fbaf40763f3a2a5e99dea49af32721fe08bb1756564d3375d`

---

## 3. Simulator Default Board (LPC1768)

- **File**: `viewer/img/controller_mbed.svg`
- **Component**: mbed LPC1768 development board breadboard drawing
- **Source**: Pre-existing simulator asset
- **License**: Apache 2.0 (Arm Ltd / Jan Jongboom)
