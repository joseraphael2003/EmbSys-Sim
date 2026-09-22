#include "stm32f413h_discovery.h"
#include "ft6x06.h"   /* FT6206_* register names/values the touch seam answers */

void LCD_IO_Init(void) {
    EM_ASM({
        window.MbedJSHal.ST7789H2.init();
    });
}

void LCD_IO_Delay(uint32_t delay) {
    // noop
}

void LCD_IO_WriteReg(uint8_t Reg) {
    EM_ASM_({
        window.MbedJSHal.ST7789H2.writeReg($0);
    }, Reg);
}

void LCD_IO_WriteData(uint16_t RegValue) {
    EM_ASM_({
        window.MbedJSHal.ST7789H2.writeData($0);
    }, RegValue);
}

uint16_t LCD_IO_ReadData(void) {
    return (uint16_t)(EM_ASM_INT({
        window.MbedJSHal.ST7789H2.readData();
    }));
}

/* Touch controller (FT6x06) bus seam.
 *
 * The virtual board has no I2C bus to the touch controller: the panel state
 * lives in the page (viewer/js-hal/st7789h2_ft6x06.js, which tracks the single
 * pointer the browser reports as MbedJSHal.ST7789H2.getTouchX()/getTouchY()).
 * The registers the FT6x06 driver reads on its single touch path -
 * ft6x06_TS_DetectTouch (TD_STATUS), ft6x06_TS_GetXY (P1_XH/XL/YH/YL),
 * ft6x06_ReadID (CHIP_ID) and ft6x06_TS_GetGestureID (GEST_ID) - are
 * synthesized from that state here, next to the driver that decodes them, using
 * the driver's own register names so the layout cannot drift.
 *
 * Registers outside that set read as 0: the model carries no state for
 * multi-touch, interrupt mode or calibration, which the panel model does not
 * represent (it reports one touch point and no gesture). */
uint16_t TS_IO_ReadMultiple(uint8_t Addr, uint8_t Reg, uint8_t *Buffer, uint16_t Length) {
    int touchX = EM_ASM_INT({
        return window.MbedJSHal.ST7789H2.getTouchX();
    });
    int touchY = EM_ASM_INT({
        return window.MbedJSHal.ST7789H2.getTouchY();
    });

    uint8_t down = (touchX != -1 && touchY != -1) ? 1 : 0;

    for (uint16_t i = 0; i < Length; i++) {
        switch (Reg + i) {
            case FT6206_TD_STAT_REG:
                Buffer[i] = down & FT6206_TD_STAT_MASK;
                break;
            /* P1_XH: [event:2 | x[11:8]] as ft6x06_TS_GetXY decodes it; the
             * panel model reports a contact, never a lift/enter event. */
            case FT6206_P1_XH_REG:
                Buffer[i] = down ? (uint8_t)((touchX >> 8) & FT6206_MSB_MASK) : 0;
                break;
            case FT6206_P1_XL_REG:
                Buffer[i] = down ? (uint8_t)(touchX & FT6206_LSB_MASK) : 0;
                break;
            case FT6206_P1_YH_REG:
                Buffer[i] = down ? (uint8_t)((touchY >> 8) & FT6206_MSB_MASK) : 0;
                break;
            case FT6206_P1_YL_REG:
                Buffer[i] = down ? (uint8_t)(touchY & FT6206_LSB_MASK) : 0;
                break;
            case FT6206_GEST_ID_REG:
                Buffer[i] = FT6206_GEST_ID_NO_GESTURE;
                break;
            case FT6206_CHIP_ID_REG:
                Buffer[i] = FT6x36_ID_VALUE;
                break;
            default:
                Buffer[i] = 0;
                break;
        }
    }

    return Length;
}

uint8_t TS_IO_Read(uint8_t Addr, uint8_t Reg) {
    uint8_t value = 0;
    TS_IO_ReadMultiple(Addr, Reg, &value, 1);
    return value;
}
