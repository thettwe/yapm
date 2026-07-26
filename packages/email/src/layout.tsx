import type { ReactNode } from 'react'
import { fonts, palette } from './theme.js'

interface LayoutProps {
  readonly preview: string
  readonly heading: string
  readonly footer: ReactNode
  readonly children: ReactNode
}

// One shell for every template, so the two messages cannot drift apart visually and a third
// template gets the frame for free.
export function Layout({ preview, heading, footer, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta content="text/html; charset=UTF-8" httpEquiv="Content-Type" />
        <meta content="width=device-width" name="viewport" />
        {/* The palette below is a light-only set of literals — an email cannot carry the app's
            token layer, so there is no dark variant to switch to. Declaring the scheme is what
            stops a dark-mode client (Apple Mail, Outlook, Gmail on Android) from auto-inverting
            it: those heuristics invert backgrounds but not every inline colour, and the result is
            dark-grey text on a dark-grey card. Both names are needed — `supported-color-schemes`
            is the one Apple Mail and Outlook read. */}
        <meta content="light" name="color-scheme" />
        <meta content="light" name="supported-color-schemes" />
        <title>{heading}</title>
      </head>
      <body
        style={{
          margin: 0,
          padding: '24px 12px',
          backgroundColor: palette.bg,
          color: palette.text1,
          fontFamily: fonts.ui,
          fontSize: '15px',
          lineHeight: 1.5,
        }}
      >
        <div
          style={{
            display: 'none',
            overflow: 'hidden',
            lineHeight: '1px',
            opacity: 0,
            maxHeight: 0,
            maxWidth: 0,
          }}
        >
          {preview}
        </div>
        <table
          align="center"
          cellPadding={0}
          cellSpacing={0}
          role="presentation"
          style={{ width: '100%', maxWidth: '560px', margin: '0 auto' }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  backgroundColor: palette.surface,
                  border: `1px solid ${palette.border}`,
                  borderRadius: '10px',
                  padding: '24px',
                }}
              >
                <h1
                  style={{
                    margin: '0 0 16px',
                    fontSize: '18px',
                    fontWeight: 600,
                    color: palette.text1,
                  }}
                >
                  {heading}
                </h1>
                {children}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '16px 8px 0', color: palette.text3, fontSize: '12px' }}>
                {footer}
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  )
}

export function Button({ href, label }: { readonly href: string; readonly label: string }) {
  return (
    <a
      href={href}
      style={{
        display: 'inline-block',
        padding: '10px 18px',
        borderRadius: '8px',
        backgroundColor: palette.accent,
        color: palette.onAccent,
        fontWeight: 600,
        fontSize: '14px',
        textDecoration: 'none',
      }}
    >
      {label}
    </a>
  )
}
