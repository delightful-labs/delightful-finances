import { defineConfig } from '@playwright/test'
import isolated from './playwright.bank-sync.config.js'

export default defineConfig({ ...isolated, testMatch: 'account-archive.e2e.ts' })
