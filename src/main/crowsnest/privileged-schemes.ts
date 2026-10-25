import { JIRA_IMAGE_CUSTOM_SCHEME } from '../jira/attachments/image-protocol'
import { MEDIA_PREVIEW_CUSTOM_SCHEME } from '../media/media-preview-protocol'
import { CROWSNEST_MEDIA_SCHEME } from './start'

export const PRIVILEGED_CUSTOM_SCHEMES = [
  MEDIA_PREVIEW_CUSTOM_SCHEME,
  JIRA_IMAGE_CUSTOM_SCHEME,
  CROWSNEST_MEDIA_SCHEME
]
