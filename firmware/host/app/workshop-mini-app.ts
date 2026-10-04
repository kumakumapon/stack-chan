import type { StackchanContext } from 'capabilities'
import { suppressCompanionIdle } from 'companion-idle'
import { localize } from 'localization'
import type { MiniAppDefinition } from 'mini-app'
import Modules from 'modules'
import { Container, Label, Text } from 'piu/MC'
import { ActionButton } from 'ui-controls'
import { uiStyles } from 'ui-theme'
import { type Story, StorySession } from 'workshop-model'
import { type WorkshopService, workshopFor } from 'workshop-service'

export function bundledStory(): Story {
  const scene = (id: string, choices: readonly { label: string; next: string }[]) => ({
    id,
    text: localize(`story.${id === 'forest' || id === 'sea' ? `scene-${id}` : id}`),
    choices,
  })
  return {
    version: 1,
    start: 'start',
    scenes: [
      scene('start', [
        { label: localize('story.forest'), next: 'forest' },
        { label: localize('story.sea'), next: 'sea' },
      ]),
      scene('forest', [
        { label: localize('story.help'), next: 'friends' },
        { label: localize('story.explore'), next: 'discovery' },
      ]),
      scene('sea', [
        { label: localize('story.help'), next: 'friends' },
        { label: localize('story.explore'), next: 'discovery' },
      ]),
      scene('friends', []),
      scene('discovery', []),
    ],
  }
}

export function createWorkshopApp(service: WorkshopService): MiniAppDefinition {
  return {
    id: 'stackchan.workshop',
    title: localize('workshop.title'),
    icon: 'play',
    create() {
      const content = new Container(null, {
        name: 'workshop',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        skin: uiStyles().screen,
      })
      const release = suppressCompanionIdle(service.context)
      let closed = false,
        revision = 0,
        offset = 0
      let page = 'home',
        selected = '',
        error = ''
      let cancelReaction: (() => void) | undefined
      const story = new StorySession(bundledStory())
      const show = (next: string) => {
        page = next
        error = ''
        render()
      }
      const text = (name: string, string: string, top: number, height = 32) =>
        content.add(new Text(null, { name, string, left: 8, right: 8, top, height, style: uiStyles().body }))
      const button = (name: string, title: string, top: number, action: () => void) => {
        const current = revision
        const control = new ActionButton(
          {
            name,
            icon: 'play',
            label: title,
            onTap: () => {
              if (closed || current !== revision) return
              try {
                action()
              } catch {
                error = localize('workshop.failed')
                render()
              }
            },
          },
          { left: 8, right: 8, top, height: 30 },
        )
        if (control.first) control.first.coordinates = { ...control.first.coordinates, top: 0 }
        content.add(control)
      }
      const perform = (action: 'pair' | 'revoke' | 'read' | 'reply' | 'delete', id?: string) => {
        void service.act(action, id)
      }
      const render = () => {
        if (closed) return
        revision++
        content.empty()
        if (page === 'home') {
          button('workshopStory', localize('workshop.story'), 0, () => show('story'))
          button('workshopInbox', localize('workshop.inbox'), 38, () => show('inbox'))
          button('workshopSettings', localize('workshop.settings'), 76, () => show('settings'))
          text('workshopDeck', service.store.deck()?.title ?? localize('workshop.bundled'), 120, 50)
        } else if (page === 'settings') {
          const settings = service.settings()
          ;(['gestures', 'sound', 'pet', 'receiving'] as const).forEach((key, index) => {
            button(
              `workshop:${key}`,
              `${settings[key] ? '[x]' : '[ ]'} ${localize(`workshop.${key}`)}`,
              index * 34,
              () => service.set(key, !settings[key]),
            )
          })
          button('workshopHome', localize('workshop.back'), 140, () => show('home'))
        } else if (page === 'story') {
          const scene = story.current()
          text('storyText', scene.text, 0, 94)
          scene.choices.forEach((choice, index) => {
            button(`storyChoice:${index}`, choice.label, 96 + index * 32, () => {
              if (!story.choose(scene.id, index)) return
              cancelReaction?.()
              cancelReaction = service.react(story.current().choices.length ? 'thinking' : 'success')
              render()
            })
          })
          if (scene.choices.length === 0) text('storyEnd', localize('story.end'), 108, 30)
          button('storyRestart', localize('story.restart'), 164, () => {
            cancelReaction?.()
            story.restart()
            render()
          })
        } else if (page === 'inbox') {
          button('inboxList', `${localize('workshop.messages')} (${service.inbox.snapshot().length})`, 0, () => {
            offset = 0
            show('list')
          })
          button('inboxPair', localize('workshop.pair'), 38, () => show('pair'))
          button('inboxRevoke', localize('workshop.revoke'), 76, () => show('revoke'))
          button('inboxHome', localize('workshop.back'), 114, () => show('home'))
          text(
            'inboxStatus',
            service.settings().receiving ? localize('workshop.receiving') : localize('workshop.receiveOff'),
            154,
            30,
          )
        } else if (page === 'list') {
          const entries = service.inbox.snapshot()
          if (offset >= entries.length) offset = Math.max(0, entries.length - 3)
          if (!entries.length) text('inboxEmpty', localize('workshop.empty'), 10, 70)
          entries.slice(offset, offset + 3).forEach((entry, index) => {
            button(`inbox:${index}`, `${entry.read ? '' : '* '}${entry.sender}: ${entry.text}`, index * 38, () => {
              selected = entry.id
              show('message')
              perform('read', entry.id)
            })
          })
          button('inboxMore', localize('workshop.more'), 120, () => {
            offset = offset + 3 < entries.length ? offset + 3 : 0
            render()
          })
          button('inboxBack', localize('workshop.back'), 160, () => show('inbox'))
        } else if (page === 'message') {
          const entry = service.inbox.snapshot().find((entry) => entry.id === selected)
          text('inboxText', entry ? `${entry.sender}\n${entry.text}` : localize('workshop.empty'), 0, 94)
          if (entry?.kind === 'message')
            button('inboxReply', localize('workshop.thanks'), 96, () => perform('reply', selected))
          if (entry)
            button('inboxDelete', localize('workshop.delete'), 128, () => {
              perform('delete', selected)
              show('list')
            })
          button('inboxBack', localize('workshop.back'), 164, () => show('list'))
        } else if (page === 'pair') {
          text('pairHint', localize('workshop.pairHint'), 0, 68)
          content.add(
            new Label(null, {
              name: 'pairCode',
              string: service.pairCode || '------------',
              left: 8,
              right: 8,
              top: 70,
              height: 30,
              style: uiStyles().body,
            }),
          )
          button('pairCreate', localize('workshop.newCode'), 120, () => perform('pair'))
          button('pairBack', localize('workshop.back'), 164, () => show('inbox'))
        } else if (page === 'revoke') {
          text('revokeHint', localize('workshop.revokeHint'), 0, 94)
          button('revokeConfirm', localize('workshop.revoke'), 120, () => {
            perform('revoke')
            show('inbox')
          })
          button('revokeCancel', localize('workshop.back'), 164, () => show('inbox'))
        }
        if (error || (service.status && page !== 'story' && page !== 'message')) {
          content.empty()
          text('workshopError', error || localize('workshop.failed'), 20, 110)
          button('workshopErrorBack', localize('workshop.back'), 154, () => {
            service.status = ''
            show('home')
          })
        }
      }
      const unsubscribe = service.subscribe(render)
      render()
      return {
        content,
        dispose() {
          closed = true
          story.close()
          cancelReaction?.()
          unsubscribe()
          release()
        },
      }
    },
  }
}

export function installWorkshop(context: StackchanContext): void {
  const service = workshopFor(context)
  context.lifecycle.onClose(context.ui.miniApps.register(createWorkshopApp(service)))
  if (Modules.has('wasm-workshop-platform')) {
    const bridge = Modules.importNow('wasm-workshop-platform') as {
      installWasmWorkshop(service: WorkshopService, context: StackchanContext): void
    }
    bridge.installWasmWorkshop(service, context)
  }
}
