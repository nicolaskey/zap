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

const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const properties = require('properties')
const dbApi = require('../db/db-api.js')
const queryPackage = require('../db/query-package.js')
const queryZcl = require('../db/query-zcl.js')
const queryLoader = require('../db/query-loader.js')
const env = require('../util/env.js')
const bin = require('../util/bin.js')
const util = require('../util/util.js')
const dbEnum = require('../../src-shared/db-enum.js')
const zclLoader = require('./zcl-loader.js')
const _ = require('lodash')

/**
 * Promises to read the JSON file and resolve all the data.
 * @param {*} ctx  Context containing information about the file
 * @returns Promise of resolved file.
 */
function collectDataFromJsonFile(ctx) {
  env.logDebug(`Collecting ZCL files from JSON file: ${ctx.metadataFile}`)
  let obj = JSON.parse(ctx.data)
  let f

  let fileLocations
  if (Array.isArray(obj.xmlRoot)) {
    fileLocations = obj.xmlRoot.map((p) =>
      path.join(path.dirname(ctx.metadataFile), p)
    )
  } else {
    fileLocations = [path.join(path.dirname(ctx.metadataFile), obj.xmlRoot)]
  }
  let zclFiles = []
  obj.xmlFile.forEach((xmlF) => {
    f = util.locateRelativeFilePath(fileLocations, xmlF)
    if (f != null) zclFiles.push(f)
  })

  ctx.zclFiles = zclFiles

  // Manufacturers XML file.
  f = util.locateRelativeFilePath(fileLocations, obj.manufacturersXml)
  if (f != null) ctx.manufacturersXml = f

  // Zcl XSD file
  f = util.locateRelativeFilePath(fileLocations, obj.zclSchema)
  if (f != null) ctx.zclSchema = f

  // Zcl Validation Script
  f = util.locateRelativeFilePath(fileLocations, obj.zclValidation)
  if (f != null) ctx.zclValidation = f

  // General options
  // Note that these values when put into OPTION_CODE will generally be converted to lowercase.
  if (obj.options) {
    ctx.options = obj.options
  }
  // Defaults. Note that the keys should be the categories that are listed for PACKAGE_OPTION, and the value should be the OPTION_CODE
  if (obj.defaults) {
    ctx.defaults = obj.defaults
  }

  ctx.version = obj.version
  ctx.supportCustomZclDevice = obj.supportCustomZclDevice

  env.logDebug(`Resolving: ${ctx.zclFiles}, version: ${ctx.version}`)
}

/**
 * Promises to read the properties file, extract all the actual xml files, and resolve with the array of files.
 *
 * @param {*} ctx Context which contains information about the propertiesFiles and data
 * @returns Promise of resolved files.
 */
async function collectDataFromPropertiesFile(ctx) {
  return new Promise((resolve, reject) => {
    env.logDebug(
      `Collecting ZCL files from properties file: ${ctx.metadataFile}`
    )

    properties.parse(ctx.data, { namespaces: true }, (err, zclProps) => {
      if (err) {
        env.logError(`Could not read file: ${ctx.metadataFile}`)
        reject(err)
      } else {
        let fileLocations = zclProps.xmlRoot
          .split(',')
          .map((p) => path.join(path.dirname(ctx.metadataFile), p))
        let zclFiles = []
        let f

        // Iterate over all XML files in the properties file, and check
        // if they exist in one or the other directory listed in xmlRoot
        zclProps.xmlFile.split(',').forEach((singleXmlFile) => {
          let fullPath = util.locateRelativeFilePath(
            fileLocations,
            singleXmlFile
          )
          if (fullPath != null) zclFiles.push(fullPath)
        })

        ctx.zclFiles = zclFiles
        // Manufacturers XML file.
        f = util.locateRelativeFilePath(
          fileLocations,
          zclProps.manufacturersXml
        )
        if (f != null) ctx.manufacturersXml = f

        // Zcl XSD file
        f = util.locateRelativeFilePath(fileLocations, zclProps.zclSchema)
        if (f != null) ctx.zclSchema = f

        // Zcl Validation Script
        f = util.locateRelativeFilePath(fileLocations, zclProps.zclValidation)
        if (f != null) ctx.zclValidation = f

        // General options
        // Note that these values when put into OPTION_CODE will generally be converted to lowercase.
        if (zclProps.options) {
          ctx.options = zclProps.options
        }
        // Defaults. Note that the keys should be the categories that are listed for PACKAGE_OPTION, and the value should be the OPTION_CODE
        if (zclProps.defaults) {
          ctx.defaults = zclProps.defaults
        }
        ctx.supportCustomZclDevice = zclProps.supportCustomZclDevice
        ctx.version = zclProps.version
        env.logDebug(`Resolving: ${ctx.zclFiles}, version: ${ctx.version}`)
        resolve(ctx)
      }
    })
  })
}

/**
 * Silabs XML does not carry types with bitmap fields, but dotdot does, so they are in the schema.
 * Just to put some data in, we differentiate between "bool" and "enum" types here.
 *
 * @param {*} mask
 * @returns bool or corresponding enum
 */
function maskToType(mask) {
  let n = parseInt(mask)
  let bitCount = bin.bitCount(n)
  if (bitCount <= 1) {
    return 'bool'
  } else if (bitCount <= 8) {
    return 'enum8'
  } else if (bitCount <= 16) {
    return 'enum16'
  } else {
    return 'enum32'
  }
}

/**
 * Prepare bitmap for database insertion.
 *
 * @param {*} bm
 * @returns Object for insertion into the database
 */
function prepareBitmap(bm) {
  let ret = { name: bm.$.name, type: bm.$.type }
  if ('field' in bm) {
    ret.fields = []
    bm.field.forEach((field, index) => {
      ret.fields.push({
        name: field.$.name,
        mask: parseInt(field.$.mask),
        type: maskToType(field.$.mask),
        ordinal: index,
      })
    })
  }
  return ret
}

/**
 * Processes bitmaps for DB insertion.
 *
 * @param {*} db
 * @param {*} filePath
 * @param {*} packageId
 * @param {*} data
 * @returns Promise of inserted bitmaps
 */
async function processBitmaps(db, filePath, packageId, data) {
  env.logDebug(`${filePath}, ${packageId}: ${data.length} bitmaps.`)
  return queryLoader.insertBitmaps(
    db,
    packageId,
    data.map((x) => prepareBitmap(x))
  )
}

/**
 * Prepare atomic to db insertion.
 *
 * @param {*} a
 */
function prepareAtomic(a) {
  return {
    name: a.$.name,
    id: parseInt(a.$.id),
    size: a.$.size,
    description: a.$.description,
    isDiscrete: a.$.discrete == 'true',
    isSigned: a.$.signed == 'true',
    isString: a.$.string == 'true',
    isLong: a.$.long == 'true',
    isChar: a.$.char == 'true',
  }
}
/**
 * Processes atomic types for DB insertion.
 *
 * @param {*} db
 * @param {*} filePath
 * @param {*} packageId
 * @param {*} data
 * @returns Promise of inserted bitmaps
 */
async function processAtomics(db, filePath, packageId, data) {
  let types = data[0].type
  env.logDebug(`${filePath}, ${packageId}: ${types.length} atomic types.`)
  return queryLoader.insertAtomics(
    db,
    packageId,
    types.map((x) => prepareAtomic(x))
  )
}

/**
 * Prepares global attribute data.
 *
 * @param {*} cluster
 * @returns Object containing the data from XML.
 */
function prepareClusterGlobalAttribute(cluster) {
  if ('globalAttribute' in cluster) {
    let ret = {}

    ret.code = parseInt(cluster.code[0], 16)
    if ('$' in cluster) {
      let mfgCode = cluster['$'].manufacturerCode
      if (mfgCode != null) ret.manufacturerCode = mfgCode
    }

    ret.globalAttribute = []
    cluster.globalAttribute.forEach((ga) => {
      if (ga.$.side == dbEnum.side.either) {
        ret.globalAttribute.push({
          code: parseInt(ga.$.code),
          side: dbEnum.side.client,
          value: ga.$.value,
        })
        ret.globalAttribute.push({
          code: parseInt(ga.$.code),
          side: dbEnum.side.server,
          value: ga.$.value,
        })
      } else {
        ret.globalAttribute.push({
          code: parseInt(ga.$.code),
          side: ga.$.side,
          value: ga.$.value,
        })
      }
    })
    return ret
  } else {
    return null
  }
}

/**
 * Prepare XML cluster for insertion into the database.
 * This method can also prepare clusterExtensions.
 *
 * @param {*} cluster
 * @returns Object containing all data from XML.
 */
function prepareCluster(cluster, isExtension = false) {
  let ret = {
    isExtension: isExtension,
  }

  if (isExtension) {
    if ('$' in cluster && 'code' in cluster.$) {
      ret.code = parseInt(cluster.$.code)
    }
  } else {
    ret.code = parseInt(cluster.code[0])
    ret.name = cluster.name[0]
    ret.description = cluster.description[0].trim()
    ret.define = cluster.define[0]
    ret.domain = cluster.domain[0]
    ret.isSingleton = false
    if ('$' in cluster) {
      if (cluster.$.manufacturerCode == null) {
        ret.manufacturerCode = null
      } else {
        ret.manufacturerCode = parseInt(cluster.$.manufacturerCode)
      }
      if (cluster.$.singleton == 'true') {
        ret.isSingleton = true
      }
      ret.introducedIn = cluster.$.introducedIn
      ret.removedIn = cluster.$.removedIn
    }
  }

  if ('command' in cluster) {
    ret.commands = []
    cluster.command.forEach((command) => {
      let cmd = {
        code: parseInt(command.$.code),
        manufacturerCode: command.$.manufacturerCode,
        name: command.$.name,
        description: command.description[0].trim(),
        source: command.$.source,
        isOptional: command.$.optional == 'true',
        introducedIn: command.$.introducedIn,
        removedIn: command.$.removedIn,
      }
      if (cmd.manufacturerCode == null) {
        cmd.manufacturerCode = ret.manufacturerCode
      } else {
        cmd.manufacturerCode = parseInt(cmd.manufacturerCode)
      }
      if ('arg' in command) {
        cmd.args = []
        command.arg.forEach((arg, index) => {
          // We are only including ones that are NOT removedIn
          if (arg.$.removedIn == null)
            cmd.args.push({
              name: arg.$.name,
              type: arg.$.type,
              isArray: arg.$.array == 'true' ? 1 : 0,
              presentIf: arg.$.presentIf,
              countArg: arg.$.countArg,
              ordinal: index,
              introducedIn: arg.$.introducedIn,
              removedIn: arg.$.removedIn,
            })
        })
      }
      ret.commands.push(cmd)
    })
  }
  if ('attribute' in cluster) {
    ret.attributes = []
    cluster.attribute.forEach((attribute) => {
      let att = {
        code: parseInt(attribute.$.code),
        manufacturerCode: attribute.$.manufacturerCode,
        name: attribute._,
        type: attribute.$.type.toLowerCase(),
        side: attribute.$.side,
        define: attribute.$.define,
        min: attribute.$.min,
        max: attribute.$.max,
        minLength: 0,
        maxLength: attribute.$.length ? attribute.$.length : null,
        isWritable: attribute.$.writable == 'true',
        defaultValue: attribute.$.default,
        isOptional: attribute.$.optional == 'true',
        isReportable: attribute.$.reportable == 'true',
        isSceneRequired: attribute.$.sceneRequired == 'true',
        introducedIn: attribute.$.introducedIn,
        removedIn: attribute.$.removedIn,
        entryType: attribute.$.entryType,
      }
      if (att.manufacturerCode == null) {
        att.manufacturerCode = ret.manufacturerCode
      } else {
        att.manufacturerCode = parseInt(att.manufacturerCode)
      }
      // If attribute has removedIn, then it's not valid any more in LATEST spec.
      if (att.removedIn == null) ret.attributes.push(att)
    })
  }
  return ret
}

/**
 * Process clusters for insertion into the database.
 *
 * @param {*} db
 * @param {*} filePath
 * @param {*} packageId
 * @param {*} data
 * @returns Promise of cluster insertion.
 */
async function processClusters(db, filePath, packageId, data) {
  env.logDebug(`${filePath}, ${packageId}: ${data.length} clusters.`)
  return queryLoader.insertClusters(
    db,
    packageId,
    data.map((x) => prepareCluster(x))
  )
}

/**
 * Processes global attributes for insertion into the database.
 *
 * @param {*} db
 * @param {*} filePath
 * @param {*} packageId
 * @param {*} data
 * @returns Promise of inserted data.
 */
function processClusterGlobalAttributes(db, filePath, packageId, data) {
  let objs = []
  data.forEach((x) => {
    let p = prepareClusterGlobalAttribute(x)
    if (p != null) objs.push(p)
  })
  if (objs.length > 0) {
    return queryLoader.insertGlobalAttributeDefault(db, packageId, objs)
  } else {
    return null
  }
}

/**
 * Cluster Extension contains attributes and commands in a same way as regular cluster,
 * and it has an attribute code="0xXYZ" where code is a cluster code.
 *
 * @param {*} db
 * @param {*} filePath
 * @param {*} packageId
 * @param {*} data
 * @returns promise to resolve the clusterExtension tags
 */
async function processClusterExtensions(db, filePath, packageId, data) {
  env.logDebug(`${filePath}, ${packageId}: ${data.length} cluster extensions.`)
  return queryLoader.insertClusterExtensions(
    db,
    packageId,
    data.map((x) => prepareCluster(x, true))
  )
}

/**
 * Processes the globals in the XML files. The `global` tag contains
 * attributes and commands in a same way as cluster or clusterExtension
 *
 * @param {*} db
 * @param {*} filePath
 * @param {*} packageId
 * @param {*} data
 * @returns promise to resolve the globals
 */
async function processGlobals(db, filePath, packageId, data) {
  env.logDebug(`${filePath}, ${packageId}: ${data.length} globals.`)
  return queryLoader.insertGlobals(
    db,
    packageId,
    data.map((x) => prepareCluster(x, true))
  )
}

/**
 * Convert domain from XMl to domain for DB.
 *
 * @param {*} domain
 * @returns Domain object for DB.
 */
function prepareDomain(domain) {
  let d = {
    name: domain.$.name,
    specCode: domain.$.spec,
    specDescription: `Latest ${domain.$.name} spec: ${domain.$.spec}`,
    specCertifiable: domain.$.certifiable == 'true',
  }
  if ('older' in domain) {
    d.older = []
    domain.older.forEach((old) => {
      d.older.push({
        specCode: old.$.spec,
        specDescription: `Older ${domain.$.name} spec ${old.$.spec}`,
        specCertifiable: old.$.certifiable == 'true',
      })
    })
  }
  return d
}

/**
 * Process domains for insertion.
 *
 * @param {*} db
 * @param {*} filePath
 * @param {*} packageId
 * @param {*} data
 * @returns Promise of database insertion of domains.
 */
async function processDomains(db, filePath, packageId, data) {
  // <domain name="ZLL" spec="zll-1.0-11-0037-10" dependsOn="zcl-1.0-07-5123-03">
  //    <older ....
  // </domain>
  env.logDebug(`${filePath}, ${packageId}: ${data.length} domains.`)
  let preparedDomains = data.map((x) => prepareDomain(x))
  let specIds = await queryLoader.insertSpecs(db, packageId, preparedDomains)
  for (let i = 0; i < specIds.length; i++) {
    preparedDomains[i].specRef = specIds[i]
  }
  return queryLoader.insertDomains(db, packageId, preparedDomains)
}

/**
 * Prepares structs for the insertion into the database.
 *
 * @param {*} struct
 * @returns Object ready to insert into the database.
 */
function prepareStruct(struct) {
  let ret = { name: struct.$.name }
  if ('item' in struct) {
    ret.items = []
    struct.item.forEach((item, index) => {
      ret.items.push({
        name: item.$.name,
        type: item.$.type,
        ordinal: index,
        entryType: item.$.entryType,
        minLength: 0,
        maxLength: item.$.length ? item.$.length : null,
        isWritable: item.$.writable == 'true',
      })
    })
  }
  return ret
}

/**
 * Processes structs.
 *
 * @param {*} db
 * @param {*} filePath
 * @param {*} packageId
 * @param {*} data
 * @returns Promise of inserted structs.
 */
async function processStructs(db, filePath, packageId, data) {
  env.logDebug(`${filePath}, ${packageId}: ${data.length} structs.`)
  return queryLoader.insertStructs(
    db,
    packageId,
    data.map((x) => prepareStruct(x))
  )
}

/**
 * Prepares an enum for insertion into the database.
 *
 * @param {*} en
 * @returns An object ready to go to the database.
 */
function prepareEnum(en) {
  let ret = { name: en.$.name, type: en.$.type }
  if ('item' in en) {
    ret.items = []
    en.item.forEach((item, index) => {
      ret.items.push({
        name: item.$.name,
        value: parseInt(item.$.value),
        ordinal: index,
      })
    })
  }
  return ret
}

/**
 * Processes the enums.
 *
 * @param {*} db
 * @param {*} filePath
 * @param {*} packageId
 * @param {*} data
 * @returns A promise of inserted enums.
 */
async function processEnums(db, filePath, packageId, data) {
  env.logDebug(`${filePath}, ${packageId}: ${data.length} enums.`)
  return queryLoader.insertEnums(
    db,
    packageId,
    data.map((x) => prepareEnum(x))
  )
}

/**
 * Preparation step for the device types.
 *
 * @param {*} deviceType
 * @returns an object containing the prepared device types.
 */
function prepareDeviceType(deviceType) {
  let ret = {
    code: parseInt(deviceType.deviceId[0]['_']),
    profileId: parseInt(deviceType.profileId[0]['_']),
    domain: deviceType.domain[0],
    name: deviceType.name[0],
    description: deviceType.typeName[0],
  }
  if ('clusters' in deviceType) {
    ret.clusters = []
    deviceType.clusters.forEach((cluster) => {
      if ('include' in cluster) {
        cluster.include.forEach((include) => {
          let attributes = []
          let commands = []
          if ('requireAttribute' in include) {
            attributes = include.requireAttribute
          }
          if ('requireCommand' in include) {
            commands = include.requireCommand
          }
          ret.clusters.push({
            client: 'true' == include.$.client,
            server: 'true' == include.$.server,
            clientLocked: 'true' == include.$.clientLocked,
            serverLocked: 'true' == include.$.serverLocked,
            clusterName:
              include.$.cluster != undefined ? include.$.cluster : include._,
            requiredAttributes: attributes,
            requiredCommands: commands,
          })
        })
      }
    })
  }
  return ret
}

/**
 * Process all device types.
 *
 * @param {*} db
 * @param {*} filePath
 * @param {*} packageId
 * @param {*} data
 * @returns Promise of a resolved device types.
 */
async function processDeviceTypes(db, filePath, packageId, data) {
  env.logDebug(`${filePath}, ${packageId}: ${data.length} deviceTypes.`)
  return queryLoader.insertDeviceTypes(
    db,
    packageId,
    data.map((x) => prepareDeviceType(x))
  )
}

/**
 * After XML parser is done with the barebones parsing, this function
 * branches the individual toplevel tags.
 *
 * @param {*} db
 * @param {*} argument
 * @returns promise that resolves when all the subtags are parsed.
 */
async function processParsedZclData(db, argument) {
  let filePath = argument.filePath
  let data = argument.result
  let packageId = argument.packageId
  if (!('result' in argument)) {
    return []
  } else {
    let promisesStep1 = []
    let promisesStep2 = []
    let promisesStep3 = []
    if ('configurator' in data) {
      if ('atomic' in data.configurator) {
        promisesStep2.push(
          processAtomics(db, filePath, packageId, data.configurator.atomic)
        )
      }
      if ('bitmap' in data.configurator) {
        promisesStep2.push(
          processBitmaps(db, filePath, packageId, data.configurator.bitmap)
        )
      }
      if ('cluster' in data.configurator) {
        promisesStep2.push(
          processClusters(db, filePath, packageId, data.configurator.cluster)
        )
        promisesStep3.push(() =>
          processClusterGlobalAttributes(
            db,
            filePath,
            packageId,
            data.configurator.cluster
          )
        )
      }
      if ('domain' in data.configurator) {
        promisesStep1.push(
          processDomains(db, filePath, packageId, data.configurator.domain)
        )
      }
      if ('enum' in data.configurator) {
        promisesStep2.push(
          processEnums(db, filePath, packageId, data.configurator.enum)
        )
      }
      if ('struct' in data.configurator) {
        promisesStep2.push(
          processStructs(db, filePath, packageId, data.configurator.struct)
        )
      }
      if ('deviceType' in data.configurator) {
        promisesStep2.push(
          processDeviceTypes(
            db,
            filePath,
            packageId,
            data.configurator.deviceType
          )
        )
      }
      if ('global' in data.configurator) {
        promisesStep2.push(
          processGlobals(db, filePath, packageId, data.configurator.global)
        )
      }
      if ('clusterExtension' in data.configurator) {
        promisesStep3.push(() =>
          processClusterExtensions(
            db,
            filePath,
            packageId,
            data.configurator.clusterExtension
          )
        )
      }
    }
    // This thing resolves the immediate promises and then resolves itself with passing the later promises down the chain.
    await Promise.all(promisesStep1)
    await Promise.all(promisesStep2)
    return Promise.all(promisesStep3)
  }
}

async function parseSingleZclFile(db, packageId, file) {
  try {
    let fileContent = await fsp.readFile(file)
    let data = {
      filePath: file,
      data: fileContent,
      crc: util.checksum(fileContent),
    }
    let result = await zclLoader.qualifyZclFile(
      db,
      data,
      packageId,
      dbEnum.packageType.zclXml,
      false
    )
    if (result.data) {
      result.result = await util.parseXml(fileContent)
      delete result.data
    }
    return processParsedZclData(db, result)
  } catch (err) {
    env.logError(`Could not load ${file}`, err)
  }
}

/**
 *
 * Promises to iterate over all the XML files and returns an aggregate promise
 * that will be resolved when all the XML files are done, or rejected if at least one fails.
 *
 * @param {*} db
 * @param {*} ctx
 * @returns Promise that resolves when all the individual promises of each file pass.
 */
async function parseZclFiles(db, packageId, zclFiles) {
  env.logDebug(`Starting to parse ZCL files: ${zclFiles}`)
  let individualFilePromise = zclFiles.map((file) =>
    parseSingleZclFile(db, packageId, file)
  )

  let laterPromises = (await Promise.all(individualFilePromise)).flat(2)
  await Promise.all(laterPromises.map((promise) => promise()))
  return zclLoader.processZclPostLoading(db)
}

/**
 * Parses the manufacturers xml.
 *
 * @param {*} db
 * @param {*} ctx
 * @returns Promise of a parsed manufacturers file.
 */
async function parseManufacturerData(db, packageId, manufacturersXml) {
  let data = await fsp.readFile(manufacturersXml)

  let manufacturerMap = await util.parseXml(data)

  return queryPackage.insertOptionsKeyValues(
    db,
    packageId,
    dbEnum.packageOptionCategory.manufacturerCodes,
    manufacturerMap.map.mapping.map((datum) => {
      let mfgPair = datum['$']
      return { code: mfgPair['code'], label: mfgPair['translation'] }
    })
  )
}

/**
 * Parses the ZCL Schema
 * @param {*} db
 */
async function parseZclSchema(db, packageId, zclSchema, zclValidation) {
  let content = await fsp.readFile(zclSchema)
  let info = {
    filePath: zclSchema,
    data: content,
    crc: util.checksum(content),
  }
  await zclLoader.qualifyZclFile(
    db,
    info,
    packageId,
    dbEnum.packageType.zclSchema,
    false
  )
  content = await fsp.readFile(zclValidation)
  info = {
    filePath: zclValidation,
    data: content,
    crc: util.checksum(content),
  }

  return zclLoader.qualifyZclFile(
    db,
    info,
    packageId,
    dbEnum.packageType.zclValidation,
    false
  )
}

/**
 * Parses and loads the text and boolean options.
 *
 * @param {*} db
 * @returns promise of parsed options
 */
async function parseOptions(db, packageId, options) {
  let promises = []
  promises.push(parseTextOptions(db, packageId, options.text))
  promises.push(parseBoolOptions(db, packageId, options.bool))
  return Promise.all(promises)
}

/**
 * Parses the text options.
 *
 * @param {*} db
 * @param {*} pkgRef
 * @param {*} textOptions
 * @returns Promise of a parsed text options.
 */
async function parseTextOptions(db, pkgRef, textOptions) {
  if (!textOptions) return Promise.resolve()
  let promises = Object.keys(textOptions).map((optionKey) => {
    let val = textOptions[optionKey]
    let optionValues
    if (Array.isArray(val)) {
      optionValues = val
    } else {
      optionValues = val.split(',').map((opt) => opt.trim())
    }
    return queryPackage.insertOptionsKeyValues(
      db,
      pkgRef,
      optionKey,
      optionValues.map((optionValue) => {
        return { code: optionValue.toLowerCase(), label: optionValue }
      })
    )
  })
  return Promise.all(promises)
}

/**
 * Parses the boolean options.
 *
 * @param {*} db
 * @param {*} pkgRef
 * @param {*} booleanCategories
 * @returns Promise of a parsed boolean options.
 */
async function parseBoolOptions(db, pkgRef, booleanCategories) {
  if (!booleanCategories) return Promise.resolve()
  let options
  if (Array.isArray(booleanCategories)) {
    options = booleanCategories
  } else {
    options = booleanCategories
      .split(',')
      .map((optionValue) => optionValue.trim())
  }
  let promises = []
  options.forEach((optionCategory) => {
    promises.push(
      queryPackage.insertOptionsKeyValues(db, pkgRef, optionCategory, [
        { code: 1, label: 'True' },
        { code: 0, label: 'False' },
      ])
    )
  })
  return Promise.all(promises)
}

/**
 * Parses the default values inside the options.
 *
 * @param {*} db
 * @param {*} ctx
 * @returns Promised of parsed text and bool defaults.
 */
async function parseDefaults(db, packageId, defaults) {
  let promises = []
  promises.push(parseTextDefaults(db, packageId, defaults.text))
  promises.push(parseBoolDefaults(db, packageId, defaults.bool))
  return Promise.all(promises)
}

async function parseTextDefaults(db, pkgRef, textDefaults) {
  if (!textDefaults) return Promise.resolve()

  let promises = []
  for (let optionCategory of Object.keys(textDefaults)) {
    let txt = textDefaults[optionCategory]
    promises.push(
      queryPackage
        .selectSpecificOptionValue(db, pkgRef, optionCategory, txt)
        .then((specificValue) => {
          if (specificValue != null) return specificValue
          if (_.isNumber(txt)) {
            // Try to convert to hex.
            let hex = '0x' + txt.toString(16)
            return queryPackage.selectSpecificOptionValue(
              db,
              pkgRef,
              optionCategory,
              hex
            )
          } else {
            return specificValue
          }
        })
        .then((specificValue) => {
          if (specificValue == null) {
            throw `Default value for: ${optionCategory}/${txt} does not match an option.`
          } else {
            return queryPackage.insertDefaultOptionValue(
              db,
              pkgRef,
              optionCategory,
              specificValue.id
            )
          }
        })
    )
  }
  return Promise.all(promises)
}

async function parseBoolDefaults(db, pkgRef, booleanCategories) {
  if (!booleanCategories) return Promise.resolve()

  let promises = []
  for (let optionCategory of Object.keys(booleanCategories)) {
    promises.push(
      queryPackage
        .selectSpecificOptionValue(
          db,
          pkgRef,
          optionCategory,
          booleanCategories[optionCategory] ? 1 : 0
        )
        .then((specificValue) =>
          queryPackage.insertDefaultOptionValue(
            db,
            pkgRef,
            optionCategory,
            specificValue.id
          )
        )
    )
  }
  return Promise.all(promises)
}

/**
 * Parses a single file.
 *
 * @param {*} db
 * @param {*} filePath
 * @returns Promise of a loaded file.
 */
async function loadIndividualSilabsFile(db, filePath, boundValidator) {
  try {
    let fileContent = await fsp.readFile(filePath)
    let data = {
      filePath: filePath,
      data: fileContent,
      crc: util.checksum(fileContent),
    }

    let result = await zclLoader.qualifyZclFile(
      db,
      data,
      null,
      dbEnum.packageType.zclXmlStandalone,
      true
    )
    let pkgId = result.packageId
    if (boundValidator != null && fileContent != null) {
      result.validation = boundValidator(fileContent)
    }
    if (result.data) {
      result.result = await util.parseXml(result.data)
      delete result.data
    }
    if (result.validation && result.validation.isValid == false) {
      throw new Error('Validation Failed')
    }
    let laterPromises = await processParsedZclData(db, result)
    await Promise.all(laterPromises.flat(1).map((promise) => promise()))
    await zclLoader.processZclPostLoading(db)
    return { succeeded: true, packageId: pkgId }
  } catch (err) {
    return { succeeded: false, err: err }
  }
}

/**
 * If custom device is supported, then this method creates it.
 *
 * @param {*} db
 * @param {*} ctx
 * @returns context
 */
async function processCustomZclDeviceType(db, packageId) {
  let customDeviceTypes = []
  customDeviceTypes.push({
    domain: dbEnum.customDevice.domain,
    code: dbEnum.customDevice.code,
    profileId: dbEnum.customDevice.profileId,
    name: dbEnum.customDevice.name,
    description: dbEnum.customDevice.description,
  })
  let existingCustomDevice = await queryZcl.selectDeviceTypeByCodeAndName(
    db,
    packageId,
    dbEnum.customDevice.code,
    dbEnum.customDevice.name
  )
  if (existingCustomDevice == null)
    await queryLoader.insertDeviceTypes(db, packageId, customDeviceTypes)
}

/**
 * Toplevel function that loads the toplevel metafile
 * and orchestrates the promise chain.
 *
 * @export
 * @param {*} db
 * @param {*} ctx The context of loading.
 * @returns a Promise that resolves with the db.
 */
async function loadSilabsZcl(db, metafile, isJson = false) {
  let ctx = {
    metadataFile: metafile,
    db: db,
  }
  env.logDebug(`Loading Silabs zcl file: ${ctx.metadataFile}`)
  await dbApi.dbBeginTransaction(db)
  try {
    Object.assign(ctx, await zclLoader.readMetadataFile(metafile))
    ctx.packageId = await zclLoader.recordToplevelPackage(
      db,
      ctx.metadataFile,
      ctx.crc
    )
    if (isJson) {
      collectDataFromJsonFile(ctx)
    } else {
      await collectDataFromPropertiesFile(ctx)
    }
    if (ctx.version != null) {
      await zclLoader.recordVersion(db, ctx.packageId, ctx.version)
    }
    await parseZclFiles(db, ctx.packageId, ctx.zclFiles)
    if (ctx.manufacturersXml) {
      await parseManufacturerData(db, ctx.packageId, ctx.manufacturersXml)
    }
    if (ctx.supportCustomZclDevice) {
      await processCustomZclDeviceType(db, ctx.packageId)
    }
    if (ctx.options) {
      await parseOptions(db, ctx.packageId, ctx.options)
    }
    if (ctx.defaults) {
      await parseDefaults(db, ctx.packageId, ctx.defaults)
    }
    if (ctx.zclSchema && ctx.zclValidation) {
      await parseZclSchema(db, ctx.packageId, ctx.zclSchema, ctx.zclValidation)
    }
  } catch (err) {
    env.logError(err)
    throw err
  } finally {
    dbApi.dbCommit(db)
  }
  return ctx
}

exports.loadSilabsZcl = loadSilabsZcl
exports.loadIndividualSilabsFile = loadIndividualSilabsFile
