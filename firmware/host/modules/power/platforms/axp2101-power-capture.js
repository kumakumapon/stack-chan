import AXP2101 from 'embedded:peripheral/Power/axp2101'
import { installRegisterCapture } from 'power-register-capture'

export const getAxp2101Power = installRegisterCapture(AXP2101.prototype)
