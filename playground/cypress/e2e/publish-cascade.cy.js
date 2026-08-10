/**
 * Publish-triggered translation with dependency cascade.
 *
 * Driven through the admin API rather than the content manager UI: the cascade
 * is background work behind a persisted queue, so the spec queues work, waits
 * for the queue to drain, and then asserts on the result.
 *
 * The **published row** is the thing under test throughout. Where a test says
 * "the published row carries the relation" it reads the public REST API, which
 * only ever sees published rows and their published link rows — the exact
 * surface the frontend reads and the exact place the relation used to vanish.
 */

const ARTICLE = 'api::article.article'
const TOPIC = 'api::topic.topic'
const DOSSIER = 'api::dossier.dossier'
const CATEGORY = 'api::category.category'

const cm = (uid, path = '') =>
  `/content-manager/collection-types/${uid}${path}`

function setAutoTranslate(settings) {
  return cy.api('PUT', '/translate/auto-translate/settings', {
    enabled: true,
    masterLocale: 'en',
    cascadeMaxEntries: 50,
    cascadeMaxDepth: 5,
    cascadeLocales: ['de'],
    cascadeIgnoreContentTypes: [],
    ...settings,
  })
}

function create(uid, data, locale = 'en') {
  return cy
    .api('POST', `${cm(uid)}?locale=${locale}`, data)
    .then((res) => {
      expect(res.status, `create ${uid}`).to.be.oneOf([200, 201])
      return res.body.data
    })
}

/**
 * The content-manager publish endpoint — which is NOT a single document-service
 * action: the controller always saves the draft first (`updateDocument`) and
 * then publishes, so every admin-panel publish reaches the plugin middleware as
 * an update-then-publish pair milliseconds apart. `data` mimics the admin
 * panel, which always sends the full form values in the publish request body.
 */
function publish(uid, documentId, locale = 'en', data = undefined) {
  return cy
    .api(
      'POST',
      `${cm(uid, `/${documentId}/actions/publish`)}?locale=${locale}`,
      data
    )
    .then((res) => {
      expect(res.status, `publish ${uid}`).to.eq(200)
      return res.body.data
    })
}

function update(uid, documentId, data, locale = 'en') {
  return cy
    .api('PUT', `${cm(uid, `/${documentId}`)}?locale=${locale}`, data)
    .then((res) => {
      expect(res.status, `update ${uid}`).to.eq(200)
      return res.body.data
    })
}

function readCm(uid, documentId, locale, status) {
  const query = status ? `?locale=${locale}&status=${status}` : `?locale=${locale}`
  return cy.api('GET', `${cm(uid, `/${documentId}`)}${query}`).then((res) => {
    if (res.status !== 200) return null
    const data = res.body.data
    // When the document exists but the requested locale/status version does
    // not, the CM controller answers 200 with `data: {}` — treat that as null
    // or every "version must not exist" assertion silently inverts.
    if (!data || Object.keys(data).length === 0) return null
    return data
  })
}

/** Public REST API — published rows only, which is what the frontend sees. */
function readPublic(pluralPath, documentId, locale, populate) {
  return cy
    .request({
      url: `/api/${pluralPath}?locale=${locale}&filters[documentId][$eq]=${documentId}&populate=${populate}`,
      failOnStatusCode: false,
    })
    .then((res) => (res.status === 200 ? res.body.data?.[0] ?? null : null))
}

function logs() {
  return cy
    .api('GET', '/translate/auto-translate/logs?limit=100')
    .then((res) => res.body.data ?? [])
}

describe('publish-triggered translation with dependency cascade', () => {
  beforeEach(() => {
    cy.exec('npm run reset')
    cy.api('DELETE', '/translate/auto-translate/logs')
    // Settings live in core_store and survive the content reset — start every
    // test disabled so fixture writes never run under the previous test's
    // settings. Each test enables what it needs, after its fixtures if the
    // fixtures must not trigger translations themselves.
    setAutoTranslate({ enabled: false, masterLocale: '' })
  })

  after(() => {
    // Leave the playground the way the other specs expect to find it.
    cy.api('PUT', '/translate/auto-translate/settings', {
      enabled: false,
      masterLocale: '',
      translateOn: 'save',
      cascade: 'off',
      autoPublish: 'trigger',
      onSourceUnpublish: 'ignore',
      cascadeLocales: null,
    })
  })

  it('9.1 — translates the missing dependency first, and the published row carries it', () => {
    create(TOPIC, { name: 'climate policy', slug: 'climate-policy' }).then(
      (topic) => {
        // The topic is published in the source locale but has no German version.
        publish(TOPIC, topic.documentId)

        // Enabled only after the fixtures exist: publishing the topic with
        // auto-translate on would queue the topic's own trigger translation and
        // the "missing dependency" premise would be gone before the test starts.
        setAutoTranslate({
          translateOn: 'publish',
          cascade: 'missing-only',
          autoPublish: 'mirror',
        })

        create(ARTICLE, {
          title: 'A warming decade',
          description: 'Summary',
          content: 'Body',
          slug: 'a-warming-decade',
          topics: { connect: [topic.documentId] },
        }).then((article) => {
          publish(ARTICLE, article.documentId)
          cy.waitForQueue()

          // The dependency was created…
          readCm(TOPIC, topic.documentId, 'de').should('not.be.null')

          // …before the article, which is what the tier ordering buys us.
          logs().then((entries) => {
            const ordered = [...entries].sort((a, b) => a.id - b.id)
            expect(ordered.map((e) => e.contentType)).to.deep.equal([
              TOPIC,
              ARTICLE,
            ])
            expect(ordered[0].isTrigger).to.eq(false)
            expect(ordered[0].publishMode).to.eq('mirror')
            expect(ordered.every((e) => e.status === 'success')).to.eq(true)
          })

          // The relation is on the article's PUBLISHED row, not only its draft.
          readPublic('articles', article.documentId, 'de', 'topics').then(
            (published) => {
              expect(published, 'German article is published').to.not.be.null
              expect(published.topics.map((t) => t.documentId)).to.include(
                topic.documentId
              )
            }
          )
        })
      }
    )
  })

  it('9.2 — a second publish queues no new cascade work', () => {
    setAutoTranslate({
      translateOn: 'publish',
      cascade: 'missing-only',
      autoPublish: 'mirror',
    })

    create(TOPIC, { name: 'robotics beat', slug: 'robotics-beat' }).then(
      (topic) => {
        publish(TOPIC, topic.documentId)
        create(ARTICLE, {
          title: 'Machines at work',
          description: 'Summary',
          content: 'Body',
          slug: 'machines-at-work',
          topics: { connect: [topic.documentId] },
        }).then((article) => {
          publish(ARTICLE, article.documentId)
          cy.waitForQueue()

          cy.api('DELETE', '/translate/auto-translate/logs')
          publish(ARTICLE, article.documentId)
          cy.waitForQueue()

          // The article itself is re-translated — that is unchanged
          // auto-translate behaviour — but nothing new is cascaded.
          logs().then((entries) => {
            expect(entries.map((e) => e.contentType)).to.deep.equal([ARTICLE])
          })
        })
      }
    )
  })

  it('9.3 — an existing target-locale dependency is never overwritten', () => {
    create(TOPIC, { name: 'urban design', slug: 'urban-design' }).then(
      (topic) => {
        publish(TOPIC, topic.documentId)

        // An editor has already written and corrected the German topic.
        update(
          TOPIC,
          topic.documentId,
          { name: 'Städtebau (edited by hand)', slug: 'staedtebau' },
          'de'
        )

        // Enabled only after the fixtures exist — with auto-translate already
        // on, publishing the topic queues the topic's own trigger translation,
        // which (correctly, for a trigger) overwrites the hand-edited German.
        setAutoTranslate({
          translateOn: 'publish',
          cascade: 'missing-only',
          autoPublish: 'mirror',
        })

        create(ARTICLE, {
          title: 'Streets for people',
          description: 'Summary',
          content: 'Body',
          slug: 'streets-for-people',
          topics: { connect: [topic.documentId] },
        }).then((article) => {
          publish(ARTICLE, article.documentId)
          cy.waitForQueue()

          readCm(TOPIC, topic.documentId, 'de').then((german) => {
            expect(german.name).to.eq('Städtebau (edited by hand)')
          })
          logs().then((entries) => {
            expect(entries.map((e) => e.contentType)).to.deep.equal([ARTICLE])
          })
        })
      }
    )
  })

  it('9.4 — translateOn: publish waits for a publish, except where there is none', () => {
    setAutoTranslate({ translateOn: 'publish', cascade: 'off' })

    // Draft & publish type: a draft save must not translate anything.
    create(ARTICLE, {
      title: 'Still a draft',
      description: 'Summary',
      content: 'Body',
      slug: 'still-a-draft',
    }).then((article) => {
      cy.wait(1500)
      logs().should('have.length', 0)
      readCm(ARTICLE, article.documentId, 'de').should('be.null')
    })

    // Category has no draft & publish — for it, saving *is* publishing.
    create(CATEGORY, { name: 'transport', slug: 'transport' }).then(
      (category) => {
        cy.waitForQueue()
        readCm(CATEGORY, category.documentId, 'de').should('not.be.null')
      }
    )
  })

  it('9.5 — publish triggers whichever shape the call arrives in', () => {
    setAutoTranslate({ translateOn: 'publish', cascade: 'off' })

    const shapes = [
      {
        name: 'publish with no locale',
        slug: 'shape-no-locale',
        act: (id) =>
          cy
            .api('POST', cm(ARTICLE, `/${id}/actions/publish`))
            .its('status')
            .should('eq', 200),
      },
      {
        name: 'publish with body data (what the admin panel sends)',
        slug: 'shape-with-data',
        act: (id) =>
          cy
            .api('POST', `${cm(ARTICLE, `/${id}/actions/publish`)}?locale=en`, {
              title: 'Publish with body data (edited)',
            })
            .its('status')
            .should('eq', 200),
      },
      // `publish({ locale: '*' })` and `update({ status: 'published' })` have
      // no content-manager REST equivalent (CM validates a single body locale
      // and always saves drafts on update) — those document-service shapes are
      // covered by the middleware unit tests instead.
    ]

    shapes.forEach(({ name, slug, act }) => {
      cy.api('DELETE', '/translate/auto-translate/logs')
      create(ARTICLE, {
        title: name,
        description: 'Summary',
        content: 'Body',
        slug,
      }).then((article) => {
        act(article.documentId)
        cy.waitForQueue()
        readCm(ARTICLE, article.documentId, 'de').should('not.be.null')
      })
    })
  })

  it('9.6 — a draft-only German dependency is left alone and reported', () => {
    create(TOPIC, { name: 'shipping', slug: 'shipping' }).then((topic) => {
      publish(TOPIC, topic.documentId)

      // The German topic exists but was never published — the "legacy" gap.
      update(
        TOPIC,
        topic.documentId,
        { name: 'Schifffahrt', slug: 'schifffahrt' },
        'de'
      )

      // Enabled only after the fixtures exist, so the topic's publish above
      // does not queue the topic's own trigger translation.
      setAutoTranslate({
        translateOn: 'publish',
        cascade: 'missing-only',
        autoPublish: 'mirror',
      })

      create(ARTICLE, {
        title: 'Ships and ports',
        description: 'Summary',
        content: 'Body',
        slug: 'ships-and-ports',
        topics: { connect: [topic.documentId] },
      }).then((article) => {
        publish(ARTICLE, article.documentId)
        cy.waitForQueue()

        // missing-only leaves it alone: a localization exists.
        logs().then((entries) => {
          expect(entries.map((e) => e.contentType)).to.deep.equal([ARTICLE])
        })
        readCm(TOPIC, topic.documentId, 'de', 'published').should('be.null')

        // And the documented consequence: the link is absent from the published
        // row. This is the known limit step 7 makes loud in the server log.
        readPublic('articles', article.documentId, 'de', 'topics').then(
          (published) => {
            expect(published, 'German article is published').to.not.be.null
            expect(published.topics ?? []).to.have.length(0)
          }
        )
      })
    })
  })

  it('9.7 — source parity: a published parent drops a draft-only child in the SOURCE locale too', () => {
    // This is the assertion Rule 3 rests on. If it fails, a cascade-created
    // draft dependency is *not* a faithful mirror of the source, the "believed
    // faithful" wording in the docs is wrong, and step 7 has to warn on that
    // case as well instead of logging it at debug.
    setAutoTranslate({ enabled: false, masterLocale: '' })

    create(TOPIC, { name: 'unpublished topic', slug: 'unpublished-topic' }).then(
      (topic) => {
        // Deliberately NOT published.
        create(ARTICLE, {
          title: 'Parent with a draft child',
          description: 'Summary',
          content: 'Body',
          slug: 'parent-with-draft-child',
          topics: { connect: [topic.documentId] },
        }).then((article) => {
          publish(ARTICLE, article.documentId)

          readPublic('articles', article.documentId, 'en', 'topics').then(
            (published) => {
              expect(published, 'English article is published').to.not.be.null
              expect(
                published.topics ?? [],
                'source parity: the published row drops the unpublished child'
              ).to.have.length(0)
            }
          )
        })
      }
    )
  })

  it("9.8 — an admin-panel publish yields a PUBLISHED translation under autoPublish: 'trigger'", () => {
    // The production defaults. The CM publish controller issues
    // update-then-publish; the update's queue row used to swallow the publish
    // trigger whole, so the flag never reached the executor and the German row
    // stayed a draft forever.
    setAutoTranslate({ translateOn: 'save', cascade: 'off', autoPublish: 'trigger' })

    create(ARTICLE, {
      title: 'Published together',
      description: 'Summary',
      content: 'Body',
      slug: 'published-together',
    }).then((article) => {
      publish(ARTICLE, article.documentId, 'en', {
        title: 'Published together',
        description: 'Summary',
        content: 'Body',
        slug: 'published-together',
      })
      cy.waitForQueue()

      // The published row is the thing under test — a draft-only German
      // article is exactly the bug.
      readCm(ARTICLE, article.documentId, 'de', 'published').should(
        'not.be.null'
      )
      logs().then((entries) => {
        const live = entries.filter((e) => e.status !== 'cancelled')
        expect(live.every((e) => e.status === 'success')).to.eq(true)
        // The surviving trigger row for the publish carries the merged flag.
        const last = [...live].sort((a, b) => a.id - b.id).pop()
        expect(last.triggerPublished).to.eq(true)
      })
    })
  })

  it('9.9 — a plain draft save still yields only a draft', () => {
    setAutoTranslate({ translateOn: 'save', cascade: 'off', autoPublish: 'trigger' })

    create(ARTICLE, {
      title: 'Stays a draft',
      description: 'Summary',
      content: 'Body',
      slug: 'stays-a-draft',
    }).then((article) => {
      cy.waitForQueue()

      readCm(ARTICLE, article.documentId, 'de').should('not.be.null')
      readCm(ARTICLE, article.documentId, 'de', 'published').should('be.null')
    })
  })

  it('handles a dependency cycle without hanging or duplicating', () => {
    setAutoTranslate({
      translateOn: 'publish',
      cascade: 'missing-only',
      autoPublish: 'mirror',
    })

    create(DOSSIER, { title: 'Cycle dossier', summary: 'x' }).then((dossier) => {
      create(TOPIC, {
        name: 'cycle topic',
        slug: 'cycle-topic',
        featuredDossier: { connect: [dossier.documentId] },
      }).then((topic) => {
        update(DOSSIER, dossier.documentId, {
          topics: { connect: [topic.documentId] },
        })
        publish(DOSSIER, dossier.documentId)
        publish(TOPIC, topic.documentId)

        create(ARTICLE, {
          title: 'Article over a cycle',
          description: 'Summary',
          content: 'Body',
          slug: 'article-over-a-cycle',
          topics: { connect: [topic.documentId] },
        }).then((article) => {
          publish(ARTICLE, article.documentId)
          cy.waitForQueue()

          logs().then((entries) => {
            const byType = entries.map((e) => e.contentType)
            expect(byType).to.include(TOPIC)
            expect(byType).to.include(DOSSIER)
            expect(byType).to.include(ARTICLE)
            // Each document is queued exactly once per locale.
            expect(new Set(entries.map((e) => e.entryDocumentId)).size).to.eq(
              entries.length
            )
            expect(entries.every((e) => e.status === 'success')).to.eq(true)
          })
        })
      })
    })
  })

  it('bounds the fan-out and says so', () => {
    const topicIds = []
    ;['bound-a', 'bound-b', 'bound-c'].forEach((slug) => {
      create(TOPIC, { name: slug, slug }).then((topic) => {
        publish(TOPIC, topic.documentId)
        topicIds.push(topic.documentId)
      })
    })

    // Enabled only after the fixtures exist, so the topic publishes above do
    // not queue their own trigger translations (which would both inflate the
    // log count and pre-create the German topics this test needs missing).
    setAutoTranslate({
      translateOn: 'publish',
      cascade: 'missing-only',
      autoPublish: 'mirror',
      cascadeMaxEntries: 2,
    })

    cy.then(() => {
      create(ARTICLE, {
        title: 'Bounded fan-out',
        description: 'Summary',
        content: 'Body',
        slug: 'bounded-fan-out',
        topics: { connect: topicIds },
      }).then((article) => {
        publish(ARTICLE, article.documentId)
        cy.waitForQueue()

        // 1 locale × (1 trigger reserved) + 1 dependency = 2 rows, no more.
        logs().should('have.length', 2)
      })
    })
  })

  it('onSourceUnpublish takes the translation offline with the source', () => {
    setAutoTranslate({
      translateOn: 'publish',
      cascade: 'off',
      autoPublish: 'mirror',
      onSourceUnpublish: 'unpublish',
    })

    create(ARTICLE, {
      title: 'Goes offline together',
      description: 'Summary',
      content: 'Body',
      slug: 'goes-offline-together',
    }).then((article) => {
      publish(ARTICLE, article.documentId)
      cy.waitForQueue()
      readCm(ARTICLE, article.documentId, 'de', 'published').should('not.be.null')

      cy.api(
        'POST',
        `${cm(ARTICLE, `/${article.documentId}/actions/unpublish`)}?locale=en`
      )
      cy.wait(2000)
      readCm(ARTICLE, article.documentId, 'de', 'published').should('be.null')
    })
  })
})
