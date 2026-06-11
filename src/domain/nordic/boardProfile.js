export const NORDIC_BOARD_ID = 'seeed_xiao_nrf52840'

const NORDIC_CAPABILITIES = [
  {
    id: 'ble_peripheral',
    family: 'ble',
    label: 'BLE Peripheral',
    zephyrSymbols: ['CONFIG_BT', 'CONFIG_BT_PERIPHERAL'],
    sample: 'samples/bluetooth/peripheral',
  },
  {
    id: 'gpio_led_button',
    family: 'led',
    label: 'GPIO LED/Button',
    zephyrSymbols: ['CONFIG_GPIO'],
    sample: 'samples/basic/blinky',
  },
  {
    id: 'uart_console',
    family: 'network',
    label: 'UART Console',
    zephyrSymbols: ['CONFIG_SERIAL', 'CONFIG_CONSOLE'],
    sample: 'samples/subsys/console/getline',
  },
  {
    id: 'i2c_sensor',
    family: 'sensor',
    label: 'I2C Sensor',
    zephyrSymbols: ['CONFIG_I2C', 'CONFIG_SENSOR'],
    sample: 'samples/sensor',
  },
]

export const NORDIC_BOARD_PROFILES = [
  {
    id: 'seeed_xiao_nrf52840',
    name: 'Seeed XIAO nRF52840',
    chip: 'nRF52840',
    module: 'XIAO BLE',
    boardTarget: 'xiao_ble',
    framework: 'nRF Connect SDK + Zephyr',
    buildTool: 'west',
    description: 'Compact nRF52840 board with native USB-C, BLE, GPIO, I2C, SPI and XIAO pinout',
  },
  {
    id: 'seeed_xiao_nrf52840_sense',
    name: 'Seeed XIAO nRF52840 Sense',
    chip: 'nRF52840',
    module: 'XIAO BLE Sense',
    boardTarget: 'xiao_ble/nrf52840/sense',
    framework: 'nRF Connect SDK + Zephyr',
    buildTool: 'west',
    description: 'XIAO nRF52840 Sense with IMU and PDM microphone on nRF Connect SDK',
  },
  {
    id: 'nrf52840dk_nrf52840',
    name: 'Nordic nRF52840 DK',
    chip: 'nRF52840',
    module: 'PCA10056 development kit',
    boardTarget: 'nrf52840dk/nrf52840',
    framework: 'nRF Connect SDK + Zephyr',
    buildTool: 'west',
    description: 'Nordic development kit with debugger, BLE, Thread, USB, GPIO, UART, I2C, SPI and PWM',
  },
]

export const NORDIC_BOARD_PROFILE = {
  ...NORDIC_BOARD_PROFILES[0],
  officialStack: {
    sdk: 'nRF Connect SDK',
    rtos: 'Zephyr RTOS',
    ide: 'nRF Connect for VS Code',
    build: 'west build',
    flash: 'west flash',
  },
  capabilities: NORDIC_CAPABILITIES,
}

export function listNordicCapabilities() {
  return NORDIC_BOARD_PROFILE.capabilities.map(capability => ({ ...capability }))
}

export function listNordicBoards() {
  return NORDIC_BOARD_PROFILES.map(board => ({ ...board }))
}

export function getNordicBoardProfile(idOrTarget = NORDIC_BOARD_ID) {
  return NORDIC_BOARD_PROFILES.find(board => board.id === idOrTarget || board.boardTarget === idOrTarget) || NORDIC_BOARD_PROFILE
}
