#!/usr/bin/env node
import { chromium } from '@playwright/test'

const url = process.env.SMOKE_URL ?? 'http://localhost:3000'
const expectedName = process.env.SMOKE_WORKSPACE_NAME ?? 'yapm'
const timeout = Number(process.env.SMOKE_TIMEOUT_MS ?? 60_000)

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout })

  const name = page.locator('[data-testid="workspace-name"]')
  await name.waitFor({ state: 'visible', timeout })
  const rendered = (await name.textContent())?.trim()
  if (rendered !== expectedName) {
    throw new Error(`workspace name rendered as "${rendered}", expected "${expectedName}"`)
  }

  await page
    .locator('[data-testid="connection-status"][data-connection="connected"]')
    .waitFor({ state: 'attached', timeout })

  if (errors.length > 0) {
    throw new Error(`browser console reported errors:\n${errors.join('\n')}`)
  }

  console.log(`smoke ok: synced workspace "${rendered}" rendered and connected`)
} finally {
  await browser.close()
}
