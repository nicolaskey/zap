/**
 *
 *    Copyright (c) 2020 Silicon Labs
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 *
 *
 * @jest-environment node
 */

const cHelper = require('../src-electron/generator/helper-c')
const env = require('../src-electron/util/env.js')
const dbApi = require('../src-electron/db/db-api.js')
const genEngine = require('../src-electron/generator/generation-engine.js')
const testUtil = require('./test-util.js')
const zclLoader = require('../src-electron/zcl/zcl-loader.js')
const zclHelper = require('../src-electron/generator/helper-zcl.js')
const dbEnum = require('../src-shared/db-enum.js')
const zapHelper = require('../src-electron/generator/helper-zap.js')

let db
const templateCount = testUtil.testTemplateCount
let zclContext

let ctx

beforeAll(() => {
  let file = env.sqliteTestFile('helpers')
  return dbApi
    .initDatabaseAndLoadSchema(file, env.schemaFile(), env.zapVersion())
    .then((d) => {
      db = d
    })
}, 5000)

afterAll(() => {
  return dbApi.closeDatabase(db)
})

test(
  'Basic gen template parsing and generation',
  () =>
    genEngine
      .loadTemplates(db, testUtil.testZigbeeGenerationTemplates)
      .then((context) => {
        expect(context.crc).not.toBeNull()
        expect(context.templateData).not.toBeNull()
        expect(context.templateData.name).toEqual('Test templates')
        expect(context.templateData.version).toEqual('test-v1')
        expect(context.templateData.templates.length).toEqual(templateCount)
        expect(context.packageId).not.toBeNull()
      }),
  3000
)

test(
  'Load ZCL stuff',
  () =>
    zclLoader.loadZcl(db, env.builtinSilabsZclMetafile).then((context) => {
      zclContext = context

      let globalCtx = {
        db: zclContext.db,
        zclPackageId: zclContext.packageId,
      }
      ctx = {
        global: globalCtx,
      }
    }),
  5000
)

/*
 * Helper-c.js
 */

test('Add one', () => {
  expect(cHelper.add_one(52)).toEqual(53)
})

test('dataTypeForEnum', () => {
  return cHelper
    .data_type_for_enum(db, 'patate', zclContext.packageId)
    .then((result) => expect(result).toBe('!!Invalid enum: patate'))
    .then(() => cHelper.data_type_for_enum(db, 'Status', zclContext.packageId))
    .then((result) => expect(result).toBe('SL_CLI_ARG_UINT8'))
})

test('dataTypeForEnum', () => {
  return cHelper
    .dataTypeForBitmap(db, 'patate', zclContext.packageId)
    .then((result) => expect(result).toBe('!!Invalid bitmap: patate'))
    .then(() =>
      cHelper.dataTypeForBitmap(db, 'LocationType', zclContext.packageId)
    )
    .then((result) => expect(result).toBe('SL_CLI_ARG_UINT8'))
})

test('Various String helper', () => {
  expect(cHelper.cleanseLabelAsKebabCase('Very Simple:Label')).toEqual(
    'very-simple-label'
  )
  // Might want to add CamelCased string
  expect(cHelper.asUnderscoreLowercase('testString')).toBe('test_string')
  expect(cHelper.asSpacedLowercase('testString')).toBe('test string')
  expect(cHelper.asUnderscoreUppercase('bigTestString')).toBe('BIG_TEST_STRING')
  expect(cHelper.asUnderscoreUppercase('BigTestString')).toBe('BIG_TEST_STRING')
})

test('asBytes helper', () => {
  return (
    cHelper.as_bytes
      .call(ctx, 'Garbage', null)
      .then((value) => expect(value).toBe('Garbage'))
      .then(() => cHelper.asBytes.call(ctx, '6', 'int8u'))
      .then((value) => expect(value).toBe('0x06'))
      .then(() => cHelper.asBytes.call(ctx, null, 'garbage'))
      .then((result) => expect(result).toBe('0x00'))
      // asBytes will return a list of character value in hex
      // if the type is invalid.
      .then(() => cHelper.asBytes.call(ctx, '9', 'garbage'))
      .then((result) => expect(result).toBe('0x39, 0x00'))
  )
})

test('FormatValue helper', () => {
  expect(cHelper.formatValue('0xAA', 1)).toBe('0xAA')
  expect(cHelper.formatValue('0xAA', 2)).toBe('0x00, 0xAA')
  expect(cHelper.formatValue('0xAA', 4)).toBe('0x00, 0x00, 0x00, 0xAA')
  expect(cHelper.formatValue('g', -1)).toBe("1,'g'")
  expect(cHelper.formatValue('42', 1)).toBe('0x2A')
  expect(cHelper.formatValue('g', 1)).toBe('0x00')
})

/*
 * Helper-zcl.js
 */
test('Various small Helper', () => {
  expect(zclHelper.isLastElement(99, 100)).toBeTruthy()

  zclHelper
    .isBitmap(ctx.global.db, 'patate', ctx.global.zclPackageId)
    .then((result) => {
      expect(result).toBe(dbEnum.zclType.unknown)
    })

  zclHelper
    .isBitmap(db, 'LocationType', zclContext.packageId)
    .then((result) => {
      expect(result).toBe(dbEnum.zclType.bitmap)
    })

  zclHelper.isEnum(db, 'patate', zclContext.packageId).then((result) => {
    expect(result).toBe(dbEnum.zclType.unknown)
  })
  zclHelper.isEnum(db, 'Status', zclContext.packageId).then((result) => {
    expect(result).toBe(dbEnum.zclType.enum)
  })

  zclHelper.isStruct(db, 'patate', zclContext.packageId).then((result) => {
    expect(result).toBe(dbEnum.zclType.unknown)
  })
  zclHelper.isStruct(db, 'Protocol', zclContext.packageId).then((result) => {
    expect(result).toBe(dbEnum.zclType.struct)
  })
})

/*
helper-zap.js
*/
test('Various small Helper', () => {
  expect(zapHelper.is_lowercase_equal('A', 'a')).toBeTruthy()
})
