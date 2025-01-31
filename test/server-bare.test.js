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

const fs = require('fs')
const path = require('path')
const axios = require('axios')
const dbApi = require('../src-electron/db/db-api.js')
const dbEnum = require('../src-shared/db-enum.js')
const queryLoader = require('../src-electron/db/query-loader.js')
const queryPackage = require('../src-electron/db/query-package.js')
const querySession = require('../src-electron/db/query-session.js')
const httpServer = require('../src-electron/server/http-server.js')
const env = require('../src-electron/util/env.js')
const exportJs = require('../src-electron/importexport/export.js')
const importJs = require('../src-electron/importexport/import.js')
const restApi = require('../src-shared/rest-api.js')
const testUtil = require('./test-util.js')
const testQuery = require('./test-query.js')
const _ = require('lodash')
const util = require('../src-electron/util/util.js')

let db
const { port, baseUrl } = testUtil.testServer(__filename)
let packageId
let sessionId, secondSessionId
let sessionCookie = null
let axiosInstance = null
let uuid = util.createUuid()

beforeAll(async () => {
  env.setDevelopmentEnv()
  let file = env.sqliteTestFile('server')
  axiosInstance = axios.create({ baseURL: baseUrl })
  db = await dbApi.initDatabaseAndLoadSchema(
    file,
    env.schemaFile(),
    env.zapVersion()
  )
}, 5000)

afterAll(() =>
  httpServer.shutdownHttpServer().then(() => dbApi.closeDatabase(db))
)

describe('Session specific tests', () => {
  test('make sure there is no session at the beginning', () =>
    testQuery.selectCountFrom(db, 'SESSION').then((cnt) => {
      expect(cnt).toBe(0)
    }))

  test('http server initialization', () => httpServer.initHttpServer(db, port))

  test('get index.html', () =>
    axiosInstance.get('/index.html').then((response) => {
      sessionCookie = response.headers['set-cookie'][0]
      axiosInstance.defaults.headers.Cookie = sessionCookie
      expect(
        response.data.includes(
          'Configuration tool for the Zigbee Cluster Library'
        )
      ).toBeTruthy()
    }))

  test('make sure there is still no session after index.html', () =>
    testQuery.selectCountFrom(db, 'SESSION').then((cnt) => {
      expect(cnt).toBe(0)
    }))

  test('test that there is 0 clusters initially', () =>
    axiosInstance
      .get(`${restApi.uri.zclCluster}all?sessionId=${uuid}`)
      .then((response) => {
        expect(response.data.clusterData.length).toBe(0)
      }))

  test('make sure there is 1 session after previous call', () =>
    testQuery.selectCountFrom(db, 'SESSION').then((cnt) => {
      expect(cnt).toBe(1)
    }))

  test('save session', () =>
    querySession.getAllSessions(db).then((results) => {
      sessionId = results[0].sessionId
    }))

  test('add a package', () =>
    queryPackage
      .insertPathCrc(db, 'PATH', 32, dbEnum.packageType.zclProperties)
      .then((pkg) => {
        packageId = pkg
      })
      .then(() => queryPackage.insertSessionPackage(db, sessionId, packageId)))

  test('load 2 clusters', () =>
    queryLoader.insertClusters(db, packageId, [
      {
        code: 0x1111,
        name: 'One',
        description: 'Cluster one',
        define: 'ONE',
      },
      {
        code: 0x2222,
        name: 'Two',
        description: 'Cluster two',
        define: 'TWO',
      },
    ]))

  test('test that there are 2 clusters now', () =>
    axiosInstance
      .get(`${restApi.uri.zclCluster}all?sessionId=${uuid}`)
      .then((response) => {
        expect(response.data.clusterData.length).toBe(2)
      }))

  test('make sure there is still 1 session after previous call', () =>
    testQuery.selectCountFrom(db, 'SESSION').then((cnt) => {
      expect(cnt).toBe(1)
    }))

  test('load domains', () =>
    queryLoader.insertDomains(db, packageId, [
      { name: 'one' },
      { name: 'two' },
      { name: 'three' },
      { name: 'four' },
    ]))

  test('test that there are domains', () =>
    axiosInstance
      .get(`${restApi.uri.zclDomain}all?sessionId=${uuid}`)
      .then((response) => {
        expect(response.data.length).toBe(4)
      }))

  // We save and then load, which creates a new session.
  test('save into a file and load from file', () => {
    let f = path.join(env.appDirectory(), 'test-output.json')
    if (fs.existsSync(f)) fs.unlinkSync(f)
    expect(fs.existsSync(f)).toBeFalsy()
    return exportJs
      .exportDataIntoFile(db, sessionId, f)
      .then(() => {
        expect(fs.existsSync(f)).toBeTruthy()
      })
      .then(() => importJs.importDataFromFile(db, f))
      .then((importResult) => {
        secondSessionId = importResult.sessionId
        fs.unlinkSync(f)
        return Promise.resolve(1)
      })
  })

  // After a new file is loaded a new session will be created.
  // Therefore, at this point, there have to be EXACTLY 2 sessions.
  test('make sure there is now 2 sessions after previous call', () =>
    testQuery.selectCountFrom(db, 'SESSION').then((cnt) => {
      expect(cnt).toBe(2)
    }))

  test('delete the first session', () =>
    querySession
      .deleteSession(db, sessionId)
      .then(() => testQuery.selectCountFrom(db, 'SESSION'))
      .then((cnt) => {
        expect(cnt).toBe(1)
      }))

  test('delete the second session', () =>
    querySession
      .deleteSession(db, secondSessionId)
      .then(() => testQuery.selectCountFrom(db, 'SESSION'))
      .then((cnt) => {
        expect(cnt).toBe(0)
      }))
})

describe('Miscelaneous REST API tests', () => {
  test('test initial state', () =>
    axiosInstance.get(restApi.uri.initialState).then((response) => {
      expect(response.data).not.toBeNull()
      expect('endpoints' in response.data).toBeTruthy()
      expect('endpointTypes' in response.data).toBeTruthy()
      expect('sessionKeyValues' in response.data).toBeTruthy()
    }))
})

describe('Admin tests', () => {
  test('test sql admin interface', () =>
    axiosInstance
      .post('/sql', { sql: 'SELECT * FROM PACKAGE' })
      .then((response) => {
        expect(response).not.toBeNull()
        expect(response.data.result).not.toBeNull()
        expect(response.data.result.length).toBeGreaterThan(1)
      }))
  test('test version interface', () =>
    axiosInstance.get('version').then((response) => {
      expect(response.data).toEqual(env.zapVersion())
    }))
})

describe('User and session tests', () => {
  let userId
  let sessionId
  test('create new user session', async () => {
    // New session
    let userSession = await querySession.ensureZapUserAndSession(
      db,
      'user1',
      'session1'
    )
    userId = userSession.userId
    sessionId = userSession.sessionId
    expect(userId).not.toBeNull()
    expect(sessionId).not.toBeNull()
    let sessions = await querySession.getUserSessions(db, userId)
    expect(sessions.length).toBe(1)
  })

  test('create new session for existing user', async () => {
    let userSession = await querySession.ensureZapUserAndSession(
      db,
      'user1',
      'session2',
      {
        userId: userId,
      }
    )
    expect(userSession.userId).toEqual(userId)
    expect(userSession.sessionId).not.toBeNull()
    expect(userSession.sessionId).not.toEqual(sessionId)
    let sessions = await querySession.getUserSessions(db, userId)
    expect(sessions.length).toBe(2)
  })

  test('create new user for existing session', async () => {
    let userSession = await querySession.ensureZapUserAndSession(
      db,
      'user2',
      'session1',
      {
        sessionId: sessionId,
      }
    )
    expect(userSession.userId).not.toBeNull()
    expect(userSession.userId).not.toEqual(userId)
    expect(userSession.sessionId).toEqual(sessionId)
    let sessions = await querySession.getUserSessions(db, userId)
    expect(sessions.length).toBe(1)
    sessions = await querySession.getUserSessions(db, userSession.userId)
    expect(sessions.length).toBe(1)
  })

  test('reuse existing user and session', async () => {
    let userSession = await querySession.ensureZapUserAndSession(
      db,
      'user1',
      'session1',
      {
        sessionId: sessionId,
        userId: userId,
      }
    )
    expect(userSession.userId).toEqual(userId)
    expect(userSession.sessionId).toEqual(sessionId)
    let sessions = await querySession.getUserSessions(db, userId)
    expect(sessions.length).toBe(1)
  })
})
