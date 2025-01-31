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

const env = require('../src-electron/util/env.js')
const util = require('../src-electron/util/util.js')
const browserApi = require('../src-electron/ui/browser-api.js')
const fs = require('fs')
const os = require('os')
const dbEnum = require('../src-shared/db-enum.js')
const path = require('path')

describe('Util Tests', () => {
  let filePath = 'foobarBackupTestFile.txt'
  let backupPath = filePath + '~'

  beforeAll(() => {})

  afterAll(() => {
    fs.unlinkSync(backupPath)
  })

  test('Relative paths', () => {
    let f = util.createAbsolutePath(
      'file',
      dbEnum.pathRelativity.relativeToUserHome
    )
    expect(path.resolve(f)).toBe(path.resolve(path.join(os.homedir(), 'file')))
  })
  test('Feature level match', () => {
    let x = util.matchFeatureLevel(0)
    expect(x.match).toBeTruthy()
    x = util.matchFeatureLevel(99999)
    expect(x.match).toBeFalsy()
    expect(x.message).not.toBeNull()
  })
  test('Create backup file', () => {
    return new Promise((resolve, reject) => {
      expect(fs.existsSync(backupPath)).toBeFalsy()
      fs.writeFile(filePath, 'foo', (err) => {
        util.createBackupFile(filePath)
        expect(fs.existsSync(backupPath)).toBeTruthy()
        expect(
          fs.readFileSync(backupPath, { encoding: 'utf8', flag: 'r' })
        ).toEqual('foo')
        fs.writeFileSync(filePath, 'bar')
        util.createBackupFile(filePath)
        expect(
          fs.readFileSync(backupPath, { encoding: 'utf8', flag: 'r' })
        ).toEqual('bar')
        resolve()
      })
    }, 5000)
  }, 5000)

  test('Test Session Key Cookies', () => {
    let testCookie = { 'connect.sid': 's%3Atest.abra' }
    expect(browserApi.getUserKeyFromBrowserCookie(testCookie)).toEqual('test')
    expect(browserApi.getUserKeyFromBrowserCookie({})).toBeNull()
    testCookie['connect.sid'] = 'tester.abra'
    expect(browserApi.getUserKeyFromBrowserCookie(testCookie)).toEqual('tester')
    testCookie['connect.sid'] = 's%3Aabra'
    expect(browserApi.getUserKeyFromBrowserCookie(testCookie)).toEqual('abra')
  })

  let array = []
  test('Sequential promise resolution', () => {
    let args = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    let fn = (arg) => {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          array.push(arg)
          resolve()
        }, 50 - 3 * arg)
      })
    }
    return util.executePromisesSequentially(args, fn).then(() => {
      expect(array).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    })
  })

  test('Type conversion', () => {
    let x = 1
    expect(x).toBeTruthy()
    expect(x == true).toBeTruthy()
    expect(x == false).not.toBeTruthy()
    x = '1'
    expect(x).toBeTruthy()
    expect(x == true).toBeTruthy()
    expect(x == false).not.toBeTruthy()
    x = 0
    expect(x).not.toBeTruthy()
    expect(x == true).not.toBeTruthy()
    expect(x == false).toBeTruthy()
    x = '0'
    expect(x).toBeTruthy() // String '0' is truthy by itself....
    expect(x == true).not.toBeTruthy() // ... but comparing to true is not truthy ...
    expect(x == false).toBeTruthy() // ... unlike comparing to false, which is truthy.
  })
})

describe('Environment Tests', () => {
  test('Test environment', () => {
    expect(env.appDirectory().length).toBeGreaterThan(10)
    expect(env.sqliteFile().length).toBeGreaterThan(10)
    expect(env.iconsDirectory().length).toBeGreaterThan(10)
  })

  test('Test logging', () => {
    env.logSql('Sql log test.')
    env.logInfo('Info log test.')
    env.logWarning('Warn log test.')
    env.logError('Error log test.')
    env.logBrowser('Browser log test.')
    env.logIpc('Ipc level test.')
    env.logIpc('Error logging test', new Error('Simple test'))
  })

  test('Versions check', () => {
    expect(env.versionsCheck()).toBeTruthy()
  })

  test('Feature level', () => {
    expect(env.zapVersion().featureLevel).toBeGreaterThan(0)
  })

  test('Version', () => {
    let v = env.zapVersion()
    expect('version' in v).toBeTruthy()
    expect('hash' in v).toBeTruthy()
    expect('timestamp' in v).toBeTruthy()
    expect('date' in v).toBeTruthy()
  })

  test('Uuid', () => {
    let uuid1 = util.createUuid()
    let uuid2 = util.createUuid()
    expect(uuid1).not.toBeNull()
    expect(uuid2).not.toBeNull()
    expect(uuid1).not.toEqual(uuid2)
  })
})
