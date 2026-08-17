import { getPage, registerPage } from '../registry.mjs'
import { Conversation } from './Conversation.jsx'

if (!getPage('conversation')) {
  registerPage({ id: 'conversation', title: 'Chat', render: Conversation })
}
