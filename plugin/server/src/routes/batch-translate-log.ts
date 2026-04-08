export default [
  {
    method: 'GET',
    path: '/batch-translate/logs',
    handler: 'batch-translate-log.getLogs',
    config: {
      policies: [
        'admin::isAuthenticatedAdmin',
        {
          name: 'plugin::content-manager.hasPermissions',
          config: { actions: ['plugin::translate.settings'] },
        },
      ],
    },
  },
  {
    method: 'DELETE',
    path: '/batch-translate/logs',
    handler: 'batch-translate-log.clearLogs',
    config: {
      policies: [
        'admin::isAuthenticatedAdmin',
        {
          name: 'plugin::content-manager.hasPermissions',
          config: { actions: ['plugin::translate.settings'] },
        },
      ],
    },
  },
]
