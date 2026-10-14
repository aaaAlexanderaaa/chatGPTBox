/* eslint-env node */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import prettier from 'prettier'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = path.join(root, 'docs/drafts')
const helpers = fs.readFileSync(path.join(directory, 'photo-operation.shared.txt'), 'utf8').trim()
for (const name of [
  'action-2-open-checked-conversation.js',
  'action-3-send-waiting-reply.js',
  'action-4-attach-photos.js',
  'action-5-select-project.js',
]) {
  const file = path.join(directory, name)
  let source = fs.readFileSync(file, 'utf8')
  source = source.replace(
    /\/\/ BEGIN PHOTO HELPERS[\s\S]*?\/\/ END PHOTO HELPERS/,
    () =>
      `// BEGIN PHOTO HELPERS\n/* eslint-disable no-unused-vars */\n${helpers}\n/* eslint-enable no-unused-vars */\n// END PHOTO HELPERS`,
  )
  if (name === 'action-4-attach-photos.js') {
    const html = fs.readFileSync(path.join(directory, 'photo-picker.html'), 'utf8')
    source = source.replace(
      /\/\/ BEGIN PHOTO PICKER[\s\S]*?\/\/ END PHOTO PICKER/,
      () =>
        `// BEGIN PHOTO PICKER\nconst PHOTO_PICKER_HTML = ${JSON.stringify(
          html,
        )}\n// END PHOTO PICKER`,
    )
  }
  source = await prettier.format(source, {
    ...(await prettier.resolveConfig(file)),
    filepath: file,
  })
  fs.writeFileSync(file, source)
  const packageNames = {
    'action-4-attach-photos.js': {
      file: 'chatgptbox-attach-photos.draftsAction',
      uuid: 'C4F066E6-6C2C-458B-BF7D-9936D54C6D7D',
      name: 'ChatGPTBox Attach Photos',
      icon: 'camera',
    },
    'action-5-select-project.js': {
      file: 'chatgptbox-select-project.draftsAction',
      uuid: 'A089F640-4F68-4810-AF68-98B46A271777',
      name: 'ChatGPTBox Select Project',
      icon: 'folder',
    },
  }
  const artifact = packageNames[name]
  if (artifact) {
    fs.writeFileSync(
      path.join(directory, artifact.file),
      JSON.stringify(
        {
          uuid: artifact.uuid,
          name: artifact.name,
          steps: [
            {
              uuid:
                artifact.uuid === 'C4F066E6-6C2C-458B-BF7D-9936D54C6D7D'
                  ? '02A06B81-5F09-42BA-97DD-960EAFDB68A3'
                  : '11C70D68-AE8C-4581-9D0C-C59EBD0F0913',
              type: 'script',
              platforms: 3,
              isEnabled: true,
              data: { script: source, allowAsync: 'false' },
            },
          ],
          shouldConfirm: false,
          disposition: 0,
          groupDisposition: 0,
          logLevel: 1,
          notificationType: 1,
          tintColor: 'green',
          keyUseIcon: true,
          icon: artifact.icon,
          visibility: 480,
          assignTags: [],
        },
        null,
        2,
      ) + '\n',
    )
  }
}
