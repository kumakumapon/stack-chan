import { MINI_APP_BAR_HEIGHT, type RegisteredMiniApp } from 'mini-app'
import type { Content as PiuContent, Scroller as PiuScroller } from 'piu/MC'
import { Column, Container, Label, Scroller } from 'piu/MC'
import { ActionButton } from 'ui-controls'
import { uiStyles } from 'ui-theme'

export type MiniAppLauncherData = Readonly<{
  apps: readonly RegisteredMiniApp[]
  onLaunch(id: string): void
}>

// Observe child touches until a drag is clear; ordinary taps still launch apps.
class MiniAppScrollerBehavior extends Behavior {
  anchor = 0
  startY = 0
  waiting = false
  onTouchBegan(scroller: PiuScroller, _id: number, _x: number, y: number) {
    this.anchor = scroller.scroll.y ?? 0
    this.startY = y
    this.waiting = true
  }
  onTouchMoved(scroller: PiuScroller, id: number, x: number, y: number, ticks: number) {
    const delta = y - this.startY
    if (this.waiting) {
      if (Math.abs(delta) < 8) return
      this.waiting = false
      scroller.captureTouch(id as unknown as string, x, y, ticks)
    }
    scroller.scrollTo(0, this.anchor - delta)
  }
}

export const MiniAppLauncher = Container.template(($: MiniAppLauncherData) => {
  const styles = uiStyles()
  const rows: PiuContent[] = $.apps.map(
    (app) =>
      new ActionButton(
        {
          name: `miniApp:${app.id}`,
          icon: app.icon ?? 'play',
          label: app.status ? `${app.title} (${app.status})` : app.title,
          onTap: () => $.onLaunch(app.id),
        },
        { left: 8, right: 8, height: 44 },
      ),
  )
  const contents: PiuContent[] =
    rows.length > 0
      ? [
          new Scroller(null, {
            left: 0,
            right: 0,
            top: 8,
            bottom: 8,
            name: 'miniAppScroller',
            active: true,
            backgroundTouch: true,
            Behavior: MiniAppScrollerBehavior,
            clip: true,
            contents: [new Column(null, { left: 0, right: 0, top: 0, contents: rows })],
          }),
        ]
      : [
          new Label(null, {
            left: 12,
            right: 12,
            top: 0,
            bottom: 0,
            string: 'ミニアプリがありません',
            style: styles.bodyMuted,
          }),
        ]
  return {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    skin: styles.screen,
    contents,
  }
})

export function createMiniAppViewport(content: PiuContent): Container {
  return new Container(null, {
    left: 0,
    right: 0,
    top: MINI_APP_BAR_HEIGHT,
    bottom: 0,
    clip: true,
    contents: [content],
  })
}
