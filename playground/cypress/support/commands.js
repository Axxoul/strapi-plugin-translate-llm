// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
Cypress.Commands.add('login', () => {
  cy.request('POST', '/admin/login', {
    email: Cypress.env('ADMIN_MAIL'),
    password: Cypress.env('ADMIN_PASSWORD'),
  }).then((result) => {
    cy.visit('/admin', {
      onBeforeLoad: (contentWindow) => {
        contentWindow.localStorage.setItem(
          'jwtToken',
          JSON.stringify(result.body.data.token)
        )
        contentWindow.localStorage.setItem(
          'userInfo',
          JSON.stringify(result.body.data.user)
        )
      },
    })
  })
})

/**
 * Admin JWT for direct API calls, cached for the run.
 *
 * The cascade is background work with a persisted queue, so the publish-cascade
 * spec drives Strapi through its admin API and polls the queue rather than
 * clicking through the content manager — a UI-driven assertion on work that
 * finishes asynchronously is a flake waiting to happen.
 */
let cachedAdminToken = null

Cypress.Commands.add('adminToken', () => {
  if (cachedAdminToken) return cy.wrap(cachedAdminToken, { log: false })
  return cy
    .request('POST', '/admin/login', {
      email: Cypress.env('ADMIN_MAIL'),
      password: Cypress.env('ADMIN_PASSWORD'),
    })
    .then((result) => {
      cachedAdminToken = result.body.data.token
      return cachedAdminToken
    })
})

Cypress.Commands.add('api', (method, url, body) =>
  cy.adminToken().then((token) =>
    cy.request({
      method,
      url,
      body,
      headers: { Authorization: `Bearer ${token}` },
      failOnStatusCode: false,
    })
  )
)

/** Block until the auto-translate queue has nothing left to do. */
Cypress.Commands.add('waitForQueue', (attemptsLeft = 60) => {
  return cy.api('GET', '/translate/auto-translate/queue').then((res) => {
    const status = res.body?.data ?? {}
    const outstanding = (status.pending ?? 0) + (status.translating ?? 0)
    if (outstanding === 0) return
    if (attemptsLeft <= 0) {
      throw new Error(
        `auto-translate queue still has ${outstanding} row(s) outstanding`
      )
    }
    cy.wait(500)
    return cy.waitForQueue(attemptsLeft - 1)
  })
})
//
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })
