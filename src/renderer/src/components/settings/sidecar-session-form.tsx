import React from 'react'
import { translate } from '@/i18n/i18n'
import { SourceKeyForm } from './source-key-form'

/** The session id form. Only Save stores the id and hands it to the sidecar; Cancel leaves the old session.
 *  A saved id closes the form even when the sample after it fails: the card shows that error. */
export function SidecarSessionForm({ onClose }: { onClose: () => Promise<void> }): React.ReactNode {
  return (
    <SourceKeyForm
      testIdPrefix="sidecar"
      keyTestId="sidecar-session"
      label={translate('leadStudio.sources.sidecar.sessionLabel', 'Instagram session id')}
      placeholder={translate(
        'leadStudio.sources.sidecar.sessionPlaceholder',
        '1234567890%3AAbCdEf…'
      )}
      hint={translate(
        'leadStudio.sources.sidecar.sessionHint',
        'Open instagram.com › DevTools › Application › Cookies › sessionid.'
      )}
      okText={(line) =>
        translate('leadStudio.sources.sidecar.sessionWorks', '✓ Session works · sample {{line}}', {
          line
        })
      }
      test={async (draft) => {
        const res = await window.api.crowsnest.call('testSidecarSessionAction', draft)
        if (!res.ok) {
          return { ok: false, message: res.error.message }
        }
        return res.value.ok
          ? { ok: true, line: res.value.line }
          : { ok: false, message: res.value.message }
      }}
      save={async (draft) => {
        const res = await window.api.crowsnest.call('saveSidecarSessionAction', draft)
        return !res.ok ? res.error.message : !res.value.ok ? res.value.error : null
      }}
      onClose={onClose}
    />
  )
}
