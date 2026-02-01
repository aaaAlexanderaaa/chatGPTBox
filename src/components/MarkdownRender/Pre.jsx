import { useMemo, useRef } from 'react'
import CopyButton from '../CopyButton'
import PropTypes from 'prop-types'

export function Pre({ className, children }) {
  const preRef = useRef(null)

  const language = useMemo(() => {
    const maybeArray = Array.isArray(children) ? children : [children]
    const codeChild = maybeArray.find((c) => c && c.props && typeof c.props.className === 'string')
    const codeClassName = (codeChild && codeChild.props && codeChild.props.className) || ''
    const match = codeClassName.match(/language-([a-zA-Z0-9_-]+)/)
    return match ? match[1] : 'code'
  }, [children])

  return (
    <div className="chatgptbox-codeblock">
      <div className="chatgptbox-codeblock-header">
        <span className="chatgptbox-codeblock-lang">{language}</span>
        <div className="chatgptbox-codeblock-actions">
          <CopyButton
            contentFn={() => preRef.current?.querySelector('code')?.textContent || ''}
            size={14}
          />
        </div>
      </div>
      <pre className={className} ref={preRef}>
        {children}
      </pre>
    </div>
  )
}

Pre.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node.isRequired,
}
