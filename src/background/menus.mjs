import Browser from 'webextension-polyfill'
import { defaultConfig, getPreferredLanguageKey, getUserConfig } from '../config/storage.mjs'
import { changeLanguage, t } from 'i18next'
import { config as menuConfig } from '../content-script/menu-tools/index.mjs'
import { RuntimeMessage } from '../protocol/messages.mjs'
import { listFunctions, localizeFunction } from '../browser-assistant/catalog.mjs'

const menuId = 'ChatGPTBox-Menu'
const onClickMenu = (info, tab) => {
  const itemId = info.menuItemId.replace(menuId, '')
  if (itemId === 'browserAssistant' || itemId.startsWith('function:')) {
    void Browser.tabs.sendMessage(
      tab.id,
      {
        type: RuntimeMessage.CreateChat,
        data: { itemId, selectionText: info.selectionText },
      },
      { frameId: info.frameId || 0 },
    )
    return
  }
  // chrome.sidePanel.open must run in the click's user-gesture stack.
  // tabs.query().then(...) drops that gesture, so open Side Panel first.
  if (itemId === 'openSidePanel') {
    menuConfig.openSidePanel.action(true, tab)
    return
  }

  Browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const currentTab = tabs[0]
    const message = {
      itemId,
      selectionText: info.selectionText,
      useMenuPosition: tab.id === currentTab.id,
    }
    console.debug('menu clicked', message)

    if (defaultConfig.selectionTools.includes(message.itemId)) {
      Browser.tabs.sendMessage(currentTab.id, {
        type: RuntimeMessage.CreateChat,
        data: message,
      })
    } else if (message.itemId.startsWith('custom_')) {
      // Handle custom selection tools
      Browser.tabs.sendMessage(currentTab.id, {
        type: RuntimeMessage.CreateChat,
        data: message,
      })
    } else if (message.itemId in menuConfig) {
      if (menuConfig[message.itemId].action) {
        menuConfig[message.itemId].action(true, tab)
      }

      if (menuConfig[message.itemId].genPrompt || menuConfig[message.itemId].functionId) {
        Browser.tabs.sendMessage(currentTab.id, {
          type: RuntimeMessage.CreateChat,
          data: message,
        })
      }
    }
  })
}
let refreshQueue = Promise.resolve()

export function refreshMenu() {
  refreshQueue = refreshQueue.catch(() => {}).then(rebuildMenu)
  return refreshQueue
}

async function rebuildMenu() {
  if (Browser.contextMenus.onClicked.hasListener(onClickMenu))
    Browser.contextMenus.onClicked.removeListener(onClickMenu)
  return Browser.contextMenus.removeAll().then(async () => {
    const userConfig = await getUserConfig()
    if (userConfig.hideContextMenu) return

    await changeLanguage(await getPreferredLanguageKey())
    await Browser.contextMenus.create({
      id: menuId,
      title: 'ChatGPTBox',
      contexts: ['all'],
    })

    if (userConfig.browserAssistantEnabled !== false) {
      await Browser.contextMenus.create({
        id: menuId + 'browserAssistant',
        parentId: menuId,
        title: t('Functions…'),
        contexts: ['all'],
      })
    }

    for (const [k, v] of Object.entries(menuConfig)) {
      if (v.functionId) continue
      await Browser.contextMenus.create({
        id: menuId + k,
        parentId: menuId,
        title: t(v.label),
        contexts: ['all'],
      })
    }
    await Browser.contextMenus.create({
      id: menuId + 'separator1',
      parentId: menuId,
      contexts: ['selection'],
      type: 'separator',
    })

    for (const item of listFunctions(userConfig, { entry: 'context-menu' })) {
      await Browser.contextMenus.create({
        id: menuId + 'function:' + item.id,
        parentId: menuId,
        title: localizeFunction(item, t).name,
        contexts:
          item.scope === 'input'
            ? ['editable']
            : item.scope === 'selection' && !item.selectionOrPage
            ? ['selection']
            : ['all'],
      })
    }

    Browser.contextMenus.onClicked.addListener(onClickMenu)
  })
}
