import { defineConfig } from '@playwright/test'
import bankSync from './playwright.bank-sync.config.js'

export default defineConfig({ ...bankSync, testMatch: 'pagination.e2e.ts' })
