export const HUANGSHAN_CAPABILITY_CONTRACTS = {
  status: {
    id: 'status',
    label: 'Status UI',
    exampleReferences: ['lvgl/watch'],
    evidencePatterns: [],
  },
  ambient_light: {
    id: 'ambient_light',
    label: 'LTR303 ambient light',
    exampleReferences: ['RT-Device/sensor'],
    includePaths: [
      "os.path.join(rtconfig.SIFLI_SDK, 'rtos/rtthread/components/drivers/sensors')",
      "os.path.join(rtconfig.SIFLI_SDK, 'customer/peripherals/sensor/LTR303')",
    ],
    projConf: ['CONFIG_BSP_USING_I2C3=y', 'CONFIG_SENSOR_USING_ASL=y', 'CONFIG_ASL_USING_LTR303=y'],
    evidencePatterns: ['light:'],
  },
  imu: {
    id: 'imu',
    label: 'LSM6DSL IMU',
    exampleReferences: ['RT-Device/sensor'],
    includePaths: [
      "os.path.join(rtconfig.SIFLI_SDK, 'rtos/rtthread/components/drivers/sensors')",
      "os.path.join(rtconfig.SIFLI_SDK, 'customer/peripherals/sensor/LSM6DSL')",
    ],
    projConf: ['CONFIG_BSP_USING_I2C3=y', 'CONFIG_SENSOR_USING_6D=y', 'CONFIG_ACC_USING_LSM6DSL=y'],
    evidencePatterns: ['acce:'],
  },
  magnetometer: {
    id: 'magnetometer',
    label: 'MMC56X3 magnetometer',
    exampleReferences: ['RT-Device/sensor'],
    includePaths: [
      "os.path.join(rtconfig.SIFLI_SDK, 'rtos/rtthread/components/drivers/sensors')",
      "os.path.join(rtconfig.SIFLI_SDK, 'customer/peripherals/sensor/MMC56x3')",
    ],
    projConf: ['CONFIG_BSP_USING_I2C3=y', 'CONFIG_SENSOR_USING_MAG=y', 'CONFIG_MAG_USING_MMC56X3=y'],
    evidencePatterns: ['mag:'],
  },
  battery: {
    id: 'battery',
    label: 'VBAT ADC',
    exampleReferences: ['adc/src/main.c'],
    projConf: ['CONFIG_BSP_USING_ADC1=y'],
    evidencePatterns: ['VBAT read value:'],
  },
  adc_gpio: {
    id: 'adc_gpio',
    label: 'PA34 ADC',
    exampleReferences: ['adc/src/main.c'],
    projConf: ['CONFIG_BSP_USING_ADC1=y'],
    evidencePatterns: ['ADC read value:'],
  },
  charger: {
    id: 'charger',
    label: 'AW32001 charger',
    exampleReferences: ['I2C/charger/src/main.c'],
    projConf: ['CONFIG_BSP_USING_I2C3=y', 'CONFIG_BSP_USING_FULL_ASSERT=y'],
    evidencePatterns: ['I2C bus found success', 'AW32001 chip ID:', 'AW32001 charge current set to:'],
  },
  bluetooth: {
    id: 'bluetooth',
    label: 'BLE peripheral',
    exampleReferences: ['example/ble/peripheral'],
    projConf: [
      'CONFIG_RT_USING_DFS_ELMFAT=y',
      'CONFIG_RT_USING_ULOG=y',
      'CONFIG_ULOG_USING_ISR_LOG=y',
      'CONFIG_ULOG_OUTPUT_THREAD_NAME=y',
      'CONFIG_BSP_USING_FULL_ASSERT=y',
      'CONFIG_BLUETOOTH=y',
      'CONFIG_BT_CON_NUM_CUSTOMIZE=y',
      'CONFIG_CFG_MAX_BT_ACL_NUM=2',
      'CONFIG_PKG_USING_FLASHDB=y',
    ],
    evidencePatterns: ['BLE advertising enabled', 'ADV start resutl', 'receive BLE power on!'],
  },
  key: {
    id: 'key',
    label: 'KEY2 GPIO43',
    exampleReferences: ['gpio/src/main.c'],
    evidencePatterns: ['KEY2'],
  },
  gpio_output: {
    id: 'gpio_output',
    label: 'GPIO20 output',
    exampleReferences: ['gpio/src/main.c'],
    evidencePatterns: ['GPIO'],
  },
  led: {
    id: 'led',
    label: 'WS2812 RGB LED',
    exampleReferences: ['ws2812/src/main.c'],
    includePaths: ["os.path.join(rtconfig.SIFLI_SDK, 'drivers/Include')"],
    projConf: [
      'CONFIG_BSP_PWM3_CC1_USING_DMA=y',
      'CONFIG_RGB_SK6812MINI_HS_ENABLE=y',
      'CONFIG_RGB_USING_SK6812MINI_HS_DEV_NAME=y',
      'CONFIG_RGB_USING_SK6812MINI_HS_PWM_DEV_NAME="pwm3"',
      'CONFIG_BSP_USING_RGBLED_CH=1',
    ],
    evidencePatterns: ['RGB LED example started!', '-> green'],
  },
  motor: {
    id: 'motor',
    label: 'Vibrator motor',
    exampleReferences: ['customer/peripherals/vibrator/vibrator.c'],
    includePaths: ["os.path.join(rtconfig.SIFLI_SDK, 'customer/peripherals/vibrator')"],
    projConf: ['VIBRATOR_ENABLED=y'],
    evidencePatterns: ['vibrator_write return', 'motor pulse'],
  },
  uart2: {
    id: 'uart2',
    label: 'UART2 external serial',
    exampleReferences: ['uart/src/main.c'],
    includePaths: ["os.path.join(rtconfig.SIFLI_SDK, 'rtos/rtthread/components/drivers/serial')"],
    projConf: ['CONFIG_BSP_USING_UART2=y'],
    evidencePatterns: ['send:', 'rev:', 'uart_rec:'],
  },
  tf_card: {
    id: 'tf_card',
    label: 'SPI TF card',
    exampleReferences: ['example/rt_device/spi_tf/src/main.c'],
    projConf: [
      'CONFIG_BSP_USING_SPI1=y',
      'CONFIG_RT_MAIN_THREAD_STACK_SIZE=4096',
      'CONFIG_FINSH_THREAD_STACK_SIZE=5120',
      'CONFIG_DFS_FILESYSTEMS_MAX=4',
      'CONFIG_DFS_FILESYSTEM_TYPES_MAX=4',
      'CONFIG_RT_USING_DFS_ELMFAT=y',
      'CONFIG_RT_DFS_ELM_MAX_SECTOR_SIZE=512',
      'CONFIG_RT_USING_SPI_MSD=y',
      'CONFIG_MSD_SPI_FORCE_IDLE=y',
      'CONFIG_BSP_USING_FULL_ASSERT=y',
    ],
    evidencePatterns: ['mount fs on flash', 'Use help to check spi sd file system command!', 'TF card block device is sd0'],
  },
  usb_fs: {
    id: 'usb_fs',
    label: 'USB CDC VCOM',
    exampleReferences: ['example/rt_device/usb/usb_vcom/src/main.c'],
    projConf: [
      'CONFIG_BSP_USING_USBD=y',
      'CONFIG_RT_USING_DFS_ELMFAT=y',
      'CONFIG__RT_USB_DEVICE_CDC=y',
      'CONFIG_RT_VCOM_TASK_STK_SIZE=1024',
      'CONFIG_RT_VCOM_TX_USE_DMA=y',
      '# CONFIG_RT_USING_HOOK is not set',
      'CONFIG_RT_CONSOLEBUF_SIZE=256',
      'CONFIG_BSP_USING_FULL_ASSERT=y',
    ],
    evidencePatterns: ['USB cdc vcom', 'USB CDC device is vcom', 'write succ!'],
  },
  audio_pdm: {
    id: 'audio_pdm',
    label: 'PDM microphone',
    exampleReferences: ['example/rt_device/pdm/src/main.c'],
    projConf: [
      'CONFIG_BSP_USING_FULL_ASSERT=y',
      'CONFIG_RT_USING_FINSH=y',
      'CONFIG_BSP_USING_PDM=y',
      'CONFIG_BSP_USING_PDM1=y',
      'CONFIG_AUDIO=y',
      'CONFIG_LXT_DISABLE=y',
      'CONFIG_BSP_USING_LCDC=n',
      'CONFIG_BSP_USING_LCD=n',
    ],
    evidencePatterns: ['PDM Record Example', 'PDM opened', 'Could not find PDM device'],
  },
  audio_i2s: {
    id: 'audio_i2s',
    label: 'I2S audio',
    exampleReferences: ['example/rt_device/i2s/src/main.c'],
    projConf: [
      'CONFIG_BSP_USING_FULL_ASSERT=y',
      'CONFIG_RT_USING_FINSH=y',
      'CONFIG_BSP_ENABLE_AUD_CODEC=y',
      'CONFIG_BSP_ENABLE_AUD_PRC=y',
      'CONFIG_RT_NAME_MAX=20',
      'CONFIG_BSP_USING_LCDC=n',
      'CONFIG_BSP_USING_LCD=n',
      'CONFIG_BSP_USING_I2S=y',
      'CONFIG_BSP_ENABLE_I2S_CODEC=y',
    ],
    evidencePatterns: ['I2S Example', 'Find i2s device failed', 'Config i2s parameter'],
  },
  audio_audprc: {
    id: 'audio_audprc',
    label: 'AUDPRC audio processor',
    exampleReferences: ['example/rt_device/audprc/src/main.c'],
    projConf: [
      'CONFIG_BSP_USING_FULL_ASSERT=y',
      'CONFIG_RT_USING_FINSH=y',
      'CONFIG_BSP_ENABLE_AUD_CODEC=y',
      'CONFIG_BSP_ENABLE_AUD_PRC=y',
      'CONFIG_RT_NAME_MAX=20',
    ],
    evidencePatterns: ['Audprc Example', 'Find audprc device failed', 'Open audprc device failed'],
  },
  low_power: {
    id: 'low_power',
    label: 'PM and DVFS',
    exampleReferences: ['example/pm/coremark/src/hcpu/main.c'],
    evidencePatterns: ['Current HCPU freq:', 'New HCPU freq:', 'Shutdown, wake up after'],
  },
}

export const HUANGSHAN_CAPABILITY_IDS = Object.freeze(Object.keys(HUANGSHAN_CAPABILITY_CONTRACTS))

export function getHuangshanCapabilityContract(id) {
  const contract = HUANGSHAN_CAPABILITY_CONTRACTS[id]
  return contract ? cloneContract(contract) : null
}

export function listHuangshanCapabilityContracts() {
  return HUANGSHAN_CAPABILITY_IDS.map(id => cloneContract(HUANGSHAN_CAPABILITY_CONTRACTS[id]))
}

export function collectHuangshanContractValues(capabilityIds = [], key) {
  const values = []
  const seen = new Set()
  for (const id of capabilityIds) {
    const contract = HUANGSHAN_CAPABILITY_CONTRACTS[id]
    for (const value of contract?.[key] || []) {
      if (seen.has(value)) continue
      seen.add(value)
      values.push(value)
    }
  }
  return values
}

function cloneContract(contract) {
  return {
    ...contract,
    exampleReferences: [...(contract.exampleReferences || [])],
    includePaths: [...(contract.includePaths || [])],
    projConf: [...(contract.projConf || [])],
    evidencePatterns: [...(contract.evidencePatterns || [])],
  }
}
