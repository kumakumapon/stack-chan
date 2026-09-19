import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStackchanToolSchemas, mergeDeviceTools, STACKCHAN_EMBODIMENT_TOOL_NAMES } from './stackchan-tools.ts'
import { EMPTY_TOOL_PARAMETERS, type ToolDefinition } from './tool-types.ts'

test('STACKCHAN_EMBODIMENT_TOOL_NAMES includes character expression tools', () => {
  assert.deepEqual(
    [...STACKCHAN_EMBODIMENT_TOOL_NAMES].sort(),
    [
      'stackchan.camera.capture',
      'stackchan.face.setEmotion',
      'stackchan.light.set',
      'stackchan.motion.lookAt',
      'stackchan.motion.setPose',
      'stackchan.say',
      'stackchan.react',
      'stackchan.perform',
    ].sort(),
  )
})

test('createStackchanToolSchemas produces device-hosted, safe, execute-less tools for every name', () => {
  const schemas = createStackchanToolSchemas()
  assert.deepEqual(schemas.map((tool) => tool.name).sort(), [...STACKCHAN_EMBODIMENT_TOOL_NAMES].sort())
  for (const tool of schemas) {
    assert.equal(tool.host, 'device')
    assert.equal(tool.permission, 'safe')
    assert.equal(tool.execute, undefined)
  }
})

test('setPose requires yaw and pitch and accepts an optional duration', () => {
  const schemas = createStackchanToolSchemas()
  const setPose = schemas.find((tool) => tool.name === 'stackchan.motion.setPose')
  assert.ok(setPose)
  assert.deepEqual(setPose.parameters.required, ['yaw', 'pitch'])
  assert.ok('yaw' in setPose.parameters.properties)
  assert.ok('pitch' in setPose.parameters.properties)
  assert.ok('durationSeconds' in setPose.parameters.properties)
})

test('lookAt requires x, y and z metres', () => {
  const schemas = createStackchanToolSchemas()
  const lookAt = schemas.find((tool) => tool.name === 'stackchan.motion.lookAt')
  assert.ok(lookAt)
  assert.deepEqual([...(lookAt.parameters.required ?? [])].sort(), ['x', 'y', 'z'])
})

test('light.set requires r, g, b and accepts an optional durationMs', () => {
  const schemas = createStackchanToolSchemas()
  const light = schemas.find((tool) => tool.name === 'stackchan.light.set')
  assert.ok(light)
  assert.deepEqual([...(light.parameters.required ?? [])].sort(), ['b', 'g', 'r'])
  assert.ok('durationMs' in light.parameters.properties)
})

test('camera.capture takes no parameters', () => {
  const schemas = createStackchanToolSchemas()
  const capture = schemas.find((tool) => tool.name === 'stackchan.camera.capture')
  assert.ok(capture)
  assert.deepEqual(Object.keys(capture.parameters.properties), [])
})

test('face.setEmotion enumerates the firmware emotion names', () => {
  const schemas = createStackchanToolSchemas()
  const setEmotion = schemas.find((tool) => tool.name === 'stackchan.face.setEmotion')
  assert.ok(setEmotion)
  const emotionProperty = setEmotion.parameters.properties.emotion as { enum?: string[] }
  assert.deepEqual([...(emotionProperty.enum ?? [])].sort(), [
    'angry',
    'cold',
    'doubtful',
    'happy',
    'hot',
    'neutral',
    'sad',
    'sleepy',
  ])
})

function deviceTool(name: string, overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return { name, parameters: EMPTY_TOOL_PARAMETERS, host: 'device', permission: 'safe', ...overrides }
}

test('mergeDeviceTools keeps only tools the device advertised', () => {
  const advertised = [deviceTool('stackchan.say')]
  const schemas = createStackchanToolSchemas()
  const merged = mergeDeviceTools(advertised, schemas)
  assert.deepEqual(
    merged.map((tool) => tool.name),
    ['stackchan.say'],
  )
})

test('mergeDeviceTools fills in the richer schema for an advertised name', () => {
  const advertised = [deviceTool('stackchan.say', { description: undefined, parameters: EMPTY_TOOL_PARAMETERS })]
  const schemas = createStackchanToolSchemas()
  const merged = mergeDeviceTools(advertised, schemas)
  const say = merged.find((tool) => tool.name === 'stackchan.say')
  assert.ok(say)
  assert.equal(say.description, schemas.find((tool) => tool.name === 'stackchan.say')?.description)
  assert.notDeepEqual(say.parameters, EMPTY_TOOL_PARAMETERS)
})

test('mergeDeviceTools drops a schema for a tool the device did not advertise', () => {
  // The device only advertised one embodiment tool; the other five schemas must not appear.
  const advertised = [deviceTool('stackchan.say')]
  const merged = mergeDeviceTools(advertised, createStackchanToolSchemas())
  assert.equal(merged.length, 1)
})

test('mergeDeviceTools passes through an advertised tool with no matching schema unchanged', () => {
  const custom = deviceTool('custom.thing', { description: 'from the device' })
  const merged = mergeDeviceTools([custom], createStackchanToolSchemas())
  assert.deepEqual(merged, [custom])
})
