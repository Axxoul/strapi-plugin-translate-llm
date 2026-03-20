'use strict'

module.exports = {
  preset: '../../jest-preset.js',
  displayName: 'OpenRouter',
  collectCoverageFrom: ['./src/lib/**/*.ts'],
  transformIgnorePatterns: ['node_modules/(?!(until-async)/)'],
}
