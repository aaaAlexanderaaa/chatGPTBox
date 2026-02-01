import { memo, useState } from 'react'
import { RefreshCw, Bot, AlertCircle } from 'lucide-react'
import CopyButton from '../CopyButton'
import ReadButton from '../ReadButton'
import PropTypes from 'prop-types'
import MarkdownRender from '../MarkdownRender/markdown.jsx'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn.mjs'

/**
 * ConversationItem - A single message in the conversation
 * Uses content-script scoped styles (no Tailwind dependency in injected UI)
 */
export function ConversationItem({ type, content, descName, onRetry }) {
  const { t } = useTranslation()
  const [showActions, setShowActions] = useState(false)

  // Question bubble - right aligned, primary color
  if (type === 'question') {
    return (
      <div className="chatgptbox-question" dir="auto">
        <div>
          <MarkdownRender>{content}</MarkdownRender>
        </div>
      </div>
    )
  }

  // Answer bubble - left aligned with AI icon
  if (type === 'answer') {
    return (
      <div
        className="chatgptbox-answer"
        dir="auto"
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        {/* AI Avatar */}
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-primary-20 border border-primary-20 flex items-center justify-center">
            <Bot size={16} className="text-primary" />
          </div>
        </div>

        {/* Message Content */}
        <div className="flex-1 min-w-0">
          <div className="prose prose-sm max-w-none">
            <MarkdownRender>{content}</MarkdownRender>
          </div>

          {/* Action buttons - show on hover */}
          {descName && (
            <div
              className={cn(
                'flex items-center gap-1 mt-2 transition-opacity',
                showActions ? 'opacity-100' : 'opacity-0',
              )}
            >
              <CopyButton contentFn={() => content.replace(/\n<hr\/>$/, '')} size={14} />
              <ReadButton contentFn={() => content} size={14} />
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="gpt-util-icon"
                  title={t('Retry')}
                >
                  <RefreshCw size={16} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Error message
  if (type === 'error') {
    return (
      <div className="chatgptbox-error" dir="auto">
        {/* Error Avatar */}
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-destructive-10 border border-destructive-10 flex items-center justify-center">
            <AlertCircle size={16} className="text-destructive" />
          </div>
        </div>

        {/* Error Content */}
        <div className="flex-1 min-w-0">
          {onRetry && (
            <button type="button" onClick={onRetry} className="gpt-util-icon" title={t('Retry')}>
              <RefreshCw size={16} />
            </button>
          )}
          <MarkdownRender>{content}</MarkdownRender>
        </div>
      </div>
    )
  }

  return null
}

ConversationItem.propTypes = {
  type: PropTypes.oneOf(['question', 'answer', 'error']).isRequired,
  content: PropTypes.string.isRequired,
  descName: PropTypes.string,
  onRetry: PropTypes.func,
}

export default memo(ConversationItem)
