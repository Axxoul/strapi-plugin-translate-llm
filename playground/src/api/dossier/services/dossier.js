'use strict'

/**
 * dossier service.
 */

const { createCoreService } = require('@strapi/strapi').factories

module.exports = createCoreService('api::dossier.dossier')
