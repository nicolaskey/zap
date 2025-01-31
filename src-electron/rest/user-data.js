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
 */

/**
 * This module provides the REST API to the user specific data.
 *
 * @module REST API: user data
 */

const env = require('../util/env.js')
const queryZcl = require('../db/query-zcl.js')
const queryConfig = require('../db/query-config.js')
const querySession = require('../db/query-session.js')
const queryPackage = require('../db/query-package.js')
const validation = require('../validation/validation.js')
const restApi = require('../../src-shared/rest-api.js')
const zclLoader = require('../zcl/zcl-loader.js')
const dbEnum = require('../../src-shared/db-enum.js')

/**
 * HTTP GET: session key values
 *
 * @param {*} db
 * @returns callback for the express uri registration
 */
function httpGetSessionKeyValues(db) {
  return (request, response) => {
    let sessionId = request.zapSessionId
    querySession
      .getAllSessionKeyValues(db, sessionId)
      .then((sessionKeyValues) =>
        response.status(restApi.httpCode.ok).json(sessionKeyValues)
      )
  }
}

/**
 * HTTP POST: save session key value
 *
 * @param {*} db
 * @returns callback for the express uri registration
 */
function httpPostSaveSessionKeyValue(db) {
  return (request, response) => {
    let { key, value } = request.body
    let sessionId = request.zapSessionId
    env.logDebug(`[${sessionId}]: Saving: ${key} => ${value}`)
    querySession
      .updateSessionKeyValue(db, sessionId, key, value)
      .then(() => {
        response.json({
          key: key,
          value: value,
        })
        response.status(restApi.httpCode.ok).send()
      })
      .catch((err) => {
        throw err
      })
  }
}

/**
 * HTTP POST: cluster
 *
 * @param {*} db
 * @returns callback for the express uri registration
 */
function httpPostCluster(db) {
  return (request, response) => {
    let { id, side, flag, endpointTypeId } = request.body
    let sessionId = request.zapSessionId
    let packageId

    queryPackage
      .getSessionPackagesByType(db, sessionId, dbEnum.packageType.zclProperties)
      .then((pkgs) => {
        packageId = pkgs[0].id
      })
      .then(() => queryConfig.getClusterState(db, endpointTypeId, id, side))
      .then((clusterState) => (clusterState == null ? true : false))
      .then((insertDefaults) => {
        return queryConfig
          .insertOrReplaceClusterState(db, endpointTypeId, id, side, flag)
          .then(() => {
            if (insertDefaults) {
              return queryConfig.insertClusterDefaults(
                db,
                endpointTypeId,
                packageId,
                {
                  clusterRef: id,
                  side: side,
                }
              )
            } else {
              return Promise.resolve()
            }
          })
          .then(() =>
            response
              .json({
                endpointTypeId: endpointTypeId,
                id: id,
                side: side,
                flag: flag,
              })
              .status(restApi.httpCode.ok)
              .send()
          )
          .catch((err) => response.status(restApi.httpCode.badRequest).send())
      })
  }
}
/**
 * HTTP POST attribute update
 *
 * @param {*} db
 * @returns callback for the express uri registration */
function httpPostAttributeUpdate(db) {
  return (request, response) => {
    let {
      action,
      endpointTypeId,
      id,
      value,
      listType,
      clusterRef,
      attributeSide,
    } = request.body
    let paramType
    switch (listType) {
      case restApi.updateKey.attributeStorage:
      case restApi.updateKey.attributeDefault:
        paramType = 'text'
        break
      default:
        paramType = ''
        break
    }
    let paramArray =
      listType == restApi.updateKey.init
        ? null
        : [{ key: listType, value: value, type: paramType }]

    queryConfig
      .insertOrUpdateAttributeState(
        db,
        endpointTypeId,
        clusterRef,
        attributeSide,
        id,
        paramArray
      )
      .then((row) =>
        queryZcl
          .selectEndpointTypeAttribute(db, endpointTypeId, id, clusterRef)
          .then((eptAttr) =>
            validation
              .validateAttribute(db, endpointTypeId, id, clusterRef)
              .then((validationData) => {
                response.json({
                  action: action,
                  endpointTypeId: endpointTypeId,
                  clusterRef: clusterRef,
                  id: id,
                  added: value,
                  listType: listType,
                  validationIssues: validationData,
                  endpointTypeAttributeData: eptAttr,
                })
                return response.status(restApi.httpCode.ok).send()
              })
          )
      )
  }
}

/**
 * HTTP POST: command update
 *
 * @param {*} db
 * @returns callback for the express uri registration
 */
function httpPostCommandUpdate(db) {
  return (request, response) => {
    let {
      action,
      endpointTypeId,
      id,
      value,
      listType,
      clusterRef,
      commandSide,
    } = request.body
    let isIncoming = null

    switch (listType) {
      case 'selectedIn':
        isIncoming = true
        break
      case 'selectedOut':
        isIncoming = false
        break
      default:
        break
    }
    queryConfig
      .insertOrUpdateCommandState(
        db,
        endpointTypeId,
        clusterRef,
        commandSide,
        id,
        value,
        isIncoming
      )
      .then(() => {
        response.json({
          action: action,
          endpointTypeId: endpointTypeId,
          id: id,
          added: value,
          listType: listType,
          side: commandSide,
          clusterRef: clusterRef,
        })
        return response.status(restApi.httpCode.ok).send()
      })
  }
}

/**
 * HTTP GET: initial state
 *
 * @param {*} db
 * @returns callback for the express uri registration
 */
function httpGetInitialState(db) {
  return (request, response) => {
    let sessionId = request.zapSessionId
    let state = {}

    let statePopulators = []
    let endpointTypes = queryConfig
      .getAllEndpointTypes(db, sessionId)
      .then((rows) => {
        state.endpointTypes = rows
      })
    statePopulators.push(endpointTypes)

    let endpoints = queryConfig.getAllEndpoints(db, sessionId).then((rows) => {
      state.endpoints = rows
    })
    statePopulators.push(endpoints)

    let sessionKeyValues = querySession
      .getAllSessionKeyValues(db, sessionId)
      .then((rows) => {
        state.sessionKeyValues = rows
      })
    statePopulators.push(sessionKeyValues)

    Promise.all(statePopulators).then(() => {
      return response.status(restApi.httpCode.ok).json(state)
    })
  }
}

/**
 * HTTP GET: option
 *
 * @param {*} db
 * @returns callback for the express uri registration
 */
function httpGetOption(db) {
  return (request, response) => {
    let sessionId = request.zapSessionId
    const { category } = request.params
    queryPackage.getSessionPackages(db, sessionId).then((packages) => {
      let p = packages.map((pkg) =>
        queryPackage.selectAllOptionsValues(db, pkg.packageRef, category)
      )
      Promise.all(p)
        .then((data) => data.flat(1))
        .then((data) => response.status(restApi.httpCode.ok).json(data))
    })
  }
}

/**
 * HTTP GET: Project packages
 */
function httpGetPackages(db) {
  return (request, response) => {
    let sessionId = request.zapSessionId
    queryPackage
      .getPackageSessionPackagePairBySessionId(db, sessionId)
      .then((packageSessionPackagePairs) =>
        response.status(restApi.httpCode.ok).json(packageSessionPackagePairs)
      )
  }
}

/**
 * HTTP POST: Add new project package
 */
function httpPostAddNewPackage(db) {
  return (req, res) => {
    let sessionId = req.zapSessionId
    let filePath = req.body.path
    zclLoader
      .loadIndividualFile(db, filePath, sessionId)
      .then((data) => {
        if (data.err) {
          return Promise.resolve({ isValid: false, err: data.err.message })
        } else {
          return queryPackage
            .insertSessionPackage(db, sessionId, data.packageId, false)
            .then(() => {
              return { isValid: true, sessionId: sessionId }
            })
        }
      })
      .then((status) => {
        return res.status(restApi.httpCode.ok).json(status)
      })
      .catch((err) => {
        console.log(err)
        return res.status(restApi.httpCode.badRequest).send()
      })
  }
}

function httpDeleteSessionPackage(db) {
  return (request, response) => {
    let { sessionRef, packageRef } = request.query
    queryPackage
      .deleteSessionPackage(db, sessionRef, packageRef)
      .then((removed) => {
        response.json({
          successful: removed > 0,
          sessionRef: sessionRef,
          packageRef: packageRef,
        })
        return response.status(restApi.httpCode.ok).send()
      })
  }
}

exports.post = [
  {
    uri: restApi.uri.cluster,
    callback: httpPostCluster,
  },
  {
    uri: restApi.uri.attributeUpdate,
    callback: httpPostAttributeUpdate,
  },
  {
    uri: restApi.uri.commandUpdate,
    callback: httpPostCommandUpdate,
  },
  {
    uri: restApi.uri.saveSessionKeyValue,
    callback: httpPostSaveSessionKeyValue,
  },
  {
    uri: restApi.uri.addNewPackage,
    callback: httpPostAddNewPackage,
  },
]

exports.get = [
  {
    uri: restApi.uri.getAllSessionKeyValues,
    callback: httpGetSessionKeyValues,
  },
  {
    uri: restApi.uri.initialState,
    callback: httpGetInitialState,
  },
  {
    uri: `${restApi.uri.option}/:category`,
    callback: httpGetOption,
  },
  {
    uri: restApi.uri.packages,
    callback: httpGetPackages,
  },
]

exports.delete = [
  {
    uri: restApi.uri.sessionPackage,
    callback: httpDeleteSessionPackage,
  },
]
