// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Source:      profiles/boards.json
// Generator:   build-tools/generate-pinnames.js
// Regenerate:  node build-tools/generate-pinnames.js
// Verify:      node build-tools/generate-pinnames.js --check
//
// MbedJSHal.PinNames holds the ACTIVE board's pin name -> pin value map at
// the top level (the default board: the board the running app was built for),
// and every board's map is also kept under MbedJSHal.PinNames.boards so the
// viewer can switch boards without a rebuild.
//
// `boards` is the only key of MbedJSHal.PinNames whose value is not a pin
// number: code that enumerates the map (the pin dropdown in viewer.js, the
// reverse lookup in components/base_component.js) has to skip non-numbers, or
// it will offer "boards" as a pin.
//
// MbedJSHal.BoardMeta (below) carries the non-pin board facts for the same
// boards: the display name and the parts soldered to them.
window.MbedJSHal = window.MbedJSHal || {};

(function(boards) {
    var active = boards.default;

    window.MbedJSHal.PinNames = {};

    Object.keys(active).forEach(function(name) {
        window.MbedJSHal.PinNames[name] = active[name];
    });

    window.MbedJSHal.PinNames.boards = boards;
})({
    'default': {
        // mbed DIP pin names (the 26 GPIO pads of the physical 40-pin header)
        'p5': 9,
        'p6': 8,
        'p7': 7,
        'p8': 6,
        'p9': 0,
        'p10': 1,
        'p11': 18,
        'p12': 17,
        'p13': 15,
        'p14': 16,
        'p15': 23,
        'p16': 24,
        'p17': 25,
        'p18': 26,
        'p19': 62,
        'p20': 63,
        'p21': 69,
        'p22': 68,
        'p23': 67,
        'p24': 66,
        'p25': 65,
        'p26': 64,
        'p27': 11,
        'p28': 10,
        'p29': 5,
        'p30': 4,

        // user LEDs and button (onboard parts, not header pads)
        'LED1': 50,
        'LED2': 52,
        'LED3': 53,
        'LED4': 55,
        'BUTTON1': 1337,

        // I2C and SPI role names
        'I2C_SCL1': 1,
        'I2C_SDA1': 0,
        'I2C_SCL2': 11,
        'I2C_SDA2': 10,
        'I2C_SCL': 11,
        'I2C_SDA': 10,
        'SPI_MOSI': 9,
        'SPI_MISO': 8,
        'SPI_SCK': 7
    },
    'pico': {
        // RP2040 GPIO pins (id = GPIO number, physical.pad = header pad)
        'GP0': 0,
        'GP1': 1,
        'GP2': 2,
        'GP3': 3,
        'GP4': 4,
        'GP5': 5,
        'GP6': 6,
        'GP7': 7,
        'GP8': 8,
        'GP9': 9,
        'GP10': 10,
        'GP11': 11,
        'GP12': 12,
        'GP13': 13,
        'GP14': 14,
        'GP15': 15,
        'GP16': 16,
        'GP17': 17,
        'GP18': 18,
        'GP19': 19,
        'GP20': 20,
        'GP21': 21,
        'GP22': 22,
        'GP26': 26,
        'GP27': 27,
        'GP28': 28,

        // onboard LED pin (not pinned out on the Pico)
        'GP25': 25,

        // ADC channel names
        'A0': 26,
        'A1': 27,
        'A2': 28,

        // role names
        'LED1': 25,
        'BUTTON1': 22,
        'I2C_SCL': 5,
        'I2C_SDA': 4,
        'SPI_SCK': 18,
        'SPI_SCLK': 18,
        'SPI_MOSI': 19,
        'SPI_MISO': 16,
        'SPI_CS': 17
    },
    'nucleo': {
        // STM32 port pins (id = Mbed CE NUCLEO_F401RE value)
        'PA_0': 0,
        'PA_1': 1,
        'PA_2': 2,
        'PA_3': 3,
        'PA_4': 4,
        'PA_5': 5,
        'PA_6': 6,
        'PA_7': 7,
        'PA_8': 8,
        'PA_9': 9,
        'PA_10': 10,
        'PA_11': 11,
        'PA_12': 12,
        'PA_13': 13,
        'PA_14': 14,
        'PA_15': 15,
        'PB_0': 16,
        'PB_1': 17,
        'PB_2': 18,
        'PB_3': 19,
        'PB_4': 20,
        'PB_5': 21,
        'PB_6': 22,
        'PB_7': 23,
        'PB_8': 24,
        'PB_9': 25,
        'PB_10': 26,
        'PB_12': 28,
        'PB_13': 29,
        'PB_14': 30,
        'PB_15': 31,
        'PC_0': 32,
        'PC_1': 33,
        'PC_2': 34,
        'PC_3': 35,
        'PC_4': 36,
        'PC_5': 37,
        'PC_6': 38,
        'PC_7': 39,
        'PC_8': 40,
        'PC_9': 41,
        'PC_10': 42,
        'PC_11': 43,
        'PC_12': 44,
        'PC_13': 45,
        'PD_2': 50,

        // Arduino Uno header names
        'D0': 3,
        'D1': 2,
        'D2': 10,
        'D3': 19,
        'D4': 21,
        'D5': 20,
        'D6': 26,
        'D7': 8,
        'D8': 9,
        'D9': 39,
        'D10': 22,
        'D11': 7,
        'D12': 6,
        'D13': 5,
        'D14': 25,
        'D15': 24,
        'A0': 0,
        'A1': 1,
        'A2': 4,
        'A3': 16,
        'A4': 33,
        'A5': 32,

        // role names
        'LED1': 5,
        'BUTTON1': 45,
        'I2C_SCL': 24,
        'I2C_SDA': 25,
        'SPI_SCK': 5,
        'SPI_MOSI': 7,
        'SPI_MISO': 6,
        'SPI_CS': 4
    }
});

// Board metadata (display name, drawing, onboard parts) - the same
// profiles/boards.json descriptors the pin maps above come from.
window.MbedJSHal.BoardMeta = {
    "default": {
        "displayName": "mbed LPC1768 (simulator default)",
        "onboardPeripherals": [
            {
                "id": "led1",
                "kind": "led",
                "label": "LED1",
                "pin": "LED1",
                "svgId": "#led1",
                "color": "#FBBE0E"
            },
            {
                "id": "led2",
                "kind": "led",
                "label": "LED2",
                "pin": "LED2",
                "svgId": "#led2",
                "color": "#FBBE0E"
            },
            {
                "id": "led3",
                "kind": "led",
                "label": "LED3",
                "pin": "LED3",
                "svgId": "#led3",
                "color": "#FBBE0E"
            },
            {
                "id": "led4",
                "kind": "led",
                "label": "LED4",
                "pin": "LED4",
                "svgId": "#led4",
                "color": "#FBBE0E"
            },
            {
                "id": "button1",
                "kind": "button",
                "label": "Button 1",
                "pin": "BUTTON1",
                "svgId": "#button1",
                "color": null
            },
            {
                "id": "u1",
                "kind": "mcu",
                "label": "LPC1768",
                "pin": null,
                "svgId": null,
                "color": null
            },
            {
                "id": "usb1",
                "kind": "connector",
                "label": "USB (drag-and-drop programming + serial)",
                "pin": null,
                "svgId": null,
                "color": null
            }
        ]
    },
    "pico": {
        "displayName": "Raspberry Pi Pico (RP2040)",
        "onboardPeripherals": [
            {
                "id": "led1",
                "kind": "led",
                "label": "onboard LED",
                "pin": "LED1",
                "svgId": "#led1",
                "color": "#2ecc71"
            },
            {
                "id": "button1",
                "kind": "button",
                "label": "BOOTSEL",
                "pin": null,
                "svgId": null,
                "color": null
            },
            {
                "id": "u1",
                "kind": "mcu",
                "label": "RP2040",
                "pin": null,
                "svgId": null,
                "color": null
            },
            {
                "id": "u2",
                "kind": "memory",
                "label": "2 MB QSPI flash (W25Q16JV)",
                "pin": null,
                "svgId": null,
                "color": null
            },
            {
                "id": "usb1",
                "kind": "connector",
                "label": "micro-USB B",
                "pin": null,
                "svgId": null,
                "color": null
            },
            {
                "id": "debug1",
                "kind": "debug",
                "label": "3-pin SWD debug pads (SWCLK/GND/SWDIO)",
                "pin": null,
                "svgId": null,
                "color": null
            }
        ]
    },
    "nucleo": {
        "displayName": "ST Nucleo-F401RE",
        "onboardPeripherals": [
            {
                "id": "led1",
                "kind": "led",
                "label": "LD2 (green user LED)",
                "pin": "LED1",
                "svgId": "#led1",
                "color": "#2ecc71"
            },
            {
                "id": "led2",
                "kind": "led",
                "label": "LD1 (USB communication LED)",
                "pin": null,
                "svgId": null,
                "color": null
            },
            {
                "id": "led3",
                "kind": "led",
                "label": "LD3 (power LED)",
                "pin": null,
                "svgId": null,
                "color": null
            },
            {
                "id": "button1",
                "kind": "button",
                "label": "B1 (blue user button)",
                "pin": "BUTTON1",
                "svgId": "#button1",
                "color": null
            },
            {
                "id": "button2",
                "kind": "button",
                "label": "B2 (black reset button)",
                "pin": null,
                "svgId": null,
                "color": null
            },
            {
                "id": "u1",
                "kind": "mcu",
                "label": "STM32F401RET6",
                "pin": null,
                "svgId": null,
                "color": null
            },
            {
                "id": "u2",
                "kind": "debug",
                "label": "ST-Link/V2-1 (SWD + virtual COM port)",
                "pin": null,
                "svgId": null,
                "color": null
            },
            {
                "id": "usb1",
                "kind": "connector",
                "label": "mini-USB B (on the ST-Link side)",
                "pin": null,
                "svgId": null,
                "color": null
            }
        ]
    }
};