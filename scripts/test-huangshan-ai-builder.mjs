import assert from 'node:assert/strict'
import {
  createHuangshanAiBuilderMessages,
  extractHuangshanBuilderConfigFromAiText,
} from '../src/domain/huangshan/aiBuilder.js'

const messages = createHuangshanAiBuilderMessages({
  userPrompt: '做一个运动手表首页，显示心率、步数、电量和蓝牙连接。',
  displayName: 'Sport Watch',
  description: 'Workout dashboard.',
})

assert.equal(messages.length, 2)
assert.equal(messages[0].role, 'system')
assert.match(messages[0].content, /JSON/)
assert.match(messages[0].content, /status/)
assert.match(messages[0].content, /metric/)
assert.match(messages[0].content, /battery/)
assert.match(messages[0].content, /bluetooth/)
assert.match(messages[0].content, /action/)
assert.match(messages[0].content, /capability/)
assert.match(messages[0].content, /ambient_light/)
assert.match(messages[0].content, /magnetometer/)
assert.match(messages[0].content, /adc_gpio/)
assert.match(messages[0].content, /gpio_output/)
assert.match(messages[0].content, /charger/)
assert.match(messages[0].content, /tf_card/)
assert.match(messages[0].content, /usb_fs/)
assert.match(messages[0].content, /audio_pdm/)
assert.match(messages[0].content, /bluetooth/)
assert.match(messages[0].content, /low_power/)
assert.match(messages[0].content, /motor/)
assert.match(messages[0].content, /UART2 RX\/TX=PA18\/PA19/)
assert.match(messages[0].content, /AW32001 charger=I2C2 PA10\/PA11 address 0x49/)
assert.match(messages[0].content, /vibrator motor=customer\/peripherals\/vibrator PA44\/PA45/)
assert.match(messages[0].content, /Never invent unavailable hardware readings/)
assert.match(messages[0].content, /Prefer real capabilities with evidence patterns/)
assert.match(messages[0].content, /Do not claim board verification until build artifacts and serial evidence exist/)
assert.match(messages[1].content, /Sport Watch/)
assert.match(messages[1].content, /运动手表首页/)

const fenced = `
\`\`\`json
{
  "displayName": "Sport Watch",
  "description": "Workout dashboard.",
  "components": [
    { "type": "status", "capability": "status", "label": "Ready", "value": "Tap to start" },
    { "type": "metric", "capability": "imu", "label": "Heart", "value": "78 bpm" },
    { "type": "metric", "capability": "magnetometer", "label": "Compass", "value": "Ready" },
    { "type": "metric", "capability": "ambient_light", "label": "Light", "value": "12 lux" },
    { "type": "metric", "capability": "charger", "label": "Charge", "value": "AW32001" },
    { "type": "battery", "capability": "battery", "label": "Battery", "value": "86%" },
    { "type": "metric", "capability": "tf_card", "label": "TF", "value": "sd0" },
    { "type": "action", "capability": "bluetooth", "label": "BLE", "value": "Advertising" },
    { "type": "raw_code", "label": "Unsafe", "value": "ignored" }
  ]
}
\`\`\`
`

const parsed = extractHuangshanBuilderConfigFromAiText(fenced, {
  displayName: 'Fallback',
  description: 'Fallback description.',
})

assert.equal(parsed.displayName, 'Sport Watch')
assert.equal(parsed.description, 'Workout dashboard.')
assert.deepEqual(parsed.components.map(component => component.type), [
  'status',
  'metric',
  'metric',
  'metric',
  'metric',
  'battery',
  'metric',
  'action',
])
assert.deepEqual(parsed.components.map(component => component.id), [
  'status_0',
  'metric_1',
  'metric_2',
  'metric_3',
  'metric_4',
  'battery_5',
  'metric_6',
  'action_7',
])
assert.deepEqual(parsed.components.map(component => component.capability), [
  'status',
  'imu',
  'magnetometer',
  'ambient_light',
  'charger',
  'battery',
  'tf_card',
  'bluetooth',
])
assert.equal(parsed.components[1].label, 'Motion')
assert.equal(parsed.components[1].value, 'LSM6DSL')
assert.equal(parsed.components[4].implementation, 'real')

const unsupportedParsed = extractHuangshanBuilderConfigFromAiText(JSON.stringify({
  displayName: 'Sport',
  description: 'Unsupported metrics must be grounded.',
  components: [
    { type: 'metric', capability: 'imu', label: 'Steps', value: '1024' },
    { type: 'metric', capability: 'status', label: 'Weather', value: 'Sunny' },
  ],
}))
assert.deepEqual(unsupportedParsed.components.map(component => [component.capability, component.label, component.value]), [
  ['imu', 'Accel', 'x/y/z'],
  ['status', 'Weather', 'Unsupported on board'],
])
assert.equal(unsupportedParsed.components[1].implementation, 'ui-only')

const motorParsed = extractHuangshanBuilderConfigFromAiText(JSON.stringify({
  displayName: 'BLE Motor',
  description: 'Vibrator request.',
  components: [
    { type: 'bluetooth', capability: 'bluetooth', label: 'BLE', value: 'Advertising' },
    { type: 'action', capability: 'motor', label: 'Buzz', value: 'Motor hook' },
  ],
}))
assert.deepEqual(motorParsed.components.map(component => component.implementation), ['real', 'real'])

assert.throws(
  () => extractHuangshanBuilderConfigFromAiText('not json', { displayName: 'Fallback', description: 'Fallback description.' }),
  /AI did not return a JSON object/,
)

console.log('huangshan AI builder tests passed')
