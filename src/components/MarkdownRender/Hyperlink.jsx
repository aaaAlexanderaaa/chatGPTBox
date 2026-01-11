import PropTypes from 'prop-types'
import Browser from 'webextension-polyfill'

const INTERNAL_DOMAINS = ['chatgpt.com', 'claude.ai', 'kimi.moonshot.cn', 'kimi.com']
const SAFE_PROTOCOLS = ['http:', 'https:']

function isInternalDomain(href) {
  try {
    const url = new URL(href)
    if (!SAFE_PROTOCOLS.includes(url.protocol)) return false
    return INTERNAL_DOMAINS.some(
      (domain) => url.hostname === domain || url.hostname.endsWith('.' + domain),
    )
  } catch {
    return false
  }
}

export function Hyperlink({ href, children }) {
  const linkProperties = {
    target: '_blank',
    style: 'color: #8ab4f8; cursor: pointer;',
    rel: 'nofollow noopener noreferrer',
  }

  if (isInternalDomain(href)) {
    const handleClick = () => {
      try {
        const url = new URL(href)
        url.searchParams.set('chatgptbox_notification', 'true')
        Browser.runtime.sendMessage({
          type: 'NEW_URL',
          data: {
            url: url.toString(),
            pinned: false,
            jumpBack: true,
          },
        })
      } catch {
        window.open(href, '_blank', 'noopener,noreferrer')
      }
    }

    return (
      <span {...linkProperties} onClick={handleClick}>
        {children}
      </span>
    )
  }

  return (
    <a href={href} {...linkProperties}>
      {children}
    </a>
  )
}

Hyperlink.propTypes = {
  href: PropTypes.string.isRequired,
  children: PropTypes.object.isRequired,
}
