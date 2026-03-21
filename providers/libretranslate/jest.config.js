'use strict'

module.exports = {
  preset: '../../jest-preset.js',
  displayName: 'Plugin',
  collectCoverageFrom: ['./lib/**/*.ts'],
  moduleNameMapper: {
    '^strapi-plugin-translate-llm/(.*)$': '<rootDir>/../../plugin/$1',
  },
}
