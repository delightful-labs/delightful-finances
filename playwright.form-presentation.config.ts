import { defineConfig } from '@playwright/test'
import isolated from './playwright.bank-sync.config.js'

export default defineConfig({ ...isolated, testMatch: 'form-presentation.e2e.ts' })
