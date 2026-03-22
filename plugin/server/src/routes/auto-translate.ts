export default [
  {
    method: 'GET',
    path: '/auto-translate/settings',
    handler: 'auto-translate.getSettings',
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
    method: 'PUT',
    path: '/auto-translate/settings',
    handler: 'auto-translate.updateSettings',
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
    method: 'GET',
    path: '/auto-translate/logs',
    handler: 'auto-translate.getLogs',
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
    path: '/auto-translate/logs',
    handler: 'auto-translate.clearLogs',
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
