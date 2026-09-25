import { describe, expect, test } from 'bun:test'
import { normalizeDisplayName } from './display-name.js'

describe('plugin display names', () => {
  test('turns a slug-shaped name into a written one', () => {
    expect(normalizeDisplayName('adobe-for-creativity')).toBe('Adobe for Creativity')
    expect(normalizeDisplayName('aws-agents-for-devsecops')).toBe('AWS Agents for DevSecOps')
    expect(normalizeDisplayName('42crunch-api-security-testing')).toBe(
      '42Crunch API Security Testing'
    )
    expect(normalizeDisplayName('build-ios-apps')).toBe('Build iOS Apps')
    expect(normalizeDisplayName('carta-cap-table')).toBe('Carta Cap Table')
    expect(normalizeDisplayName('huggingface-skills')).toBe('Hugging Face Skills')
    expect(normalizeDisplayName('ui5-typescript-conversion')).toBe('UI5 TypeScript Conversion')
    expect(normalizeDisplayName('mcp_server_dev')).toBe('MCP Server Dev')
    expect(normalizeDisplayName('monday CRM')).toBe('Monday CRM')
    expect(normalizeDisplayName('amd-skills')).toBe('AMD Skills')
  })

  test('keeps the vendor casing a name already carries', () => {
    // Idempotence matters: the function runs on every build, over names a
    // curator may have written by hand.
    for (const name of [
      'Gmail',
      'iMessage',
      'eToro Trading',
      'PDF Viewer',
      'Setup MCP Agent Analytics',
      'GitHub',
      'NVIDIA',
      'Datadog',
    ])
      expect(normalizeDisplayName(name)).toBe(name)
  })

  test('keeps domain-style names and small words readable', () => {
    expect(normalizeDisplayName('incident.io')).toBe('Incident.io')
    expect(normalizeDisplayName('monday.com')).toBe('Monday.com')
    // The slug form hides the domain, so the token rules alone cannot get there.
    expect(normalizeDisplayName('monday-com')).toBe('Monday.com')
    expect(normalizeDisplayName('bigdata-com')).toBe('BigData.com')
    expect(normalizeDisplayName('incident-io')).toBe('Incident.io')
    expect(normalizeDisplayName('vpai')).toBe('VPAI')
    expect(normalizeDisplayName('Claude for Financial Advisors')).toBe(
      'Claude for Financial Advisors'
    )
    expect(normalizeDisplayName('claude-for-financial-advisors')).toBe(
      'Claude for Financial Advisors'
    )
  })

  test('leaves a name it cannot improve alone', () => {
    expect(normalizeDisplayName('')).toBe('')
    expect(normalizeDisplayName('   ')).toBe('   ')
  })
})
