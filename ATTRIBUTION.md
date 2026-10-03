# Third-Party Asset Attributions and Licenses

This repository vendors vector graphic assets for virtual board profiles in the Mbed Simulator. Each asset is listed below with its authoritative upstream source, applicable license, and SHA-256 checksum.

---

## 1. Raspberry Pi Pico Breadboard Vector Graphic

- **File**: `viewer/img/controller_pico.svg`
- **Component**: Raspberry Pi Pico (RP2040) virtual board breadboard drawing
- **Source**: Raspberry Pi Ltd official hardware design files for Raspberry Pi Pico (Revision 3 / Pico-R3).
  - Upstream package: `RP-008310-DS-1-Pico-R3-Fritzing.zip` (containing `Pico-R3-Fritzing.fzpz`)
  - Source URL: `https://pip.raspberrypi.com/categories/610-raspberry-pi-pico` / `https://pip-assets.raspberrypi.com/categories/610-raspberry-pi-pico/documents/RP-008310-DS-1-Pico-R3-Fritzing.zip`
  - Extracted member: `svg.breadboard.rpi_pico-tht_1_breadboard.svg`
  - Upstream authors: Alasdair Allan / Jack Wills (modified by vanepp Jan 2021)
- **Modifications**: Added element `id="led1"` to the GP25 onboard LED ellipse (`circle222`, `cx="179.77859" cy="256.97235"`) and set default off-state fill (`fill="black"`).
- **License / Terms of Use**:
  Primary source grant from the official Raspberry Pi documentation repository (`github.com/raspberrypi/documentation`, path `documentation/asciidoc/microcontrollers/pico-series/about_pico.adoc:104-108`, corresponding to `pip.raspberrypi.com/documents/RP-008310-DS`; identical terms at `documentation/asciidoc/microcontrollers/microcontroller-chips/rp2040.adoc:67`):

  > "Design files for Raspberry Pi Pico and Pico H are openly available with no limitations. Raspberry Pi grants permission to use, copy, modify, and distribute the following designs for any purpose, with or without fee. Designs are provided 'as-is' without warranty of any kind, either express or implied, including, but not limited to, the implied warranties of merchantability and fitness for a particular purpose. In no event shall Raspberry Pi be liable for any claim, damages or other liability arising from the use of these designs."

- **SHA-256 Checksum** (`viewer/img/controller_pico.svg`):
  `b9318dfd9224b990779e0f38911f2c9aa1123a3e63487ef689bbb30d9a7200ab`

---

## 2. STM32 Nucleo Board Breadboard Vector Graphic

- **File**: `viewer/img/controller_nucleo.svg`
- **Component**: STMicroelectronics Nucleo-64 (STM32F401RE) virtual board breadboard drawing
- **Source**: Fritzing open source parts repository (`fritzing-parts` core library).
  - Source URL: `https://raw.githubusercontent.com/fritzing/fritzing-parts/master/svg/core/breadboard/STM32_Nucleo_board_breadboard.svg`
  - Upstream author: Fabian Althaus (Fritzing core team)
- **Modifications**: Added user LED LD2 (green LED, connected to PA_5 / D13) at `x="123.32" y="60.0"` with `id="led1"` and silk text `LD2` at `x="122.5" y="69.5"` (positioned in clear PCB space below the D13 pin and `SCK/D13` header label, without overlapping any silkscreen), and stamped `id="button1"` onto user button B1 (blue push button, connected to PC_13) at `cx="78.431" cy="117.602"`.
- **License**: Creative Commons Attribution-ShareAlike 3.0 Unported (CC-BY-SA 3.0)
  - Copyright (c) Fritzing project (Friends-of-Fritzing e.V. and contributors).
  - License terms: http://creativecommons.org/licenses/by-sa/3.0/
- **SHA-256 Checksum** (`viewer/img/controller_nucleo.svg`):
  `1615bf68e566e21ca3abc0588c1841eebe22479ad4c9f51861d767357a960033`

---

## 3. Simulator Default Board (LPC1768)

- **File**: `viewer/img/controller_mbed.svg`
- **Component**: mbed LPC1768 development board breadboard drawing
- **Source**: Pre-existing simulator asset
- **License**: Apache 2.0 (Arm Ltd / Jan Jongboom)
