import { describe, expect, it } from 'vitest'
import { extractFileId, extractFolderId } from './folder'

describe('extractFolderId', () => {
  it('extracts from a standard folder URL', () => {
    expect(extractFolderId('https://drive.google.com/drive/folders/1ABCdefGhi-jklMNO_pq')).toBe(
      '1ABCdefGhi-jklMNO_pq',
    )
  })

  it('extracts from a folder URL with a sharing query string', () => {
    expect(
      extractFolderId('https://drive.google.com/drive/folders/1IkkIYY6PV-EukVsNbO_ySXLNJ7ofVfA1?usp=sharing'),
    ).toBe('1IkkIYY6PV-EukVsNbO_ySXLNJ7ofVfA1')
  })

  it('extracts from a "u/0" account-scoped URL', () => {
    expect(
      extractFolderId('https://drive.google.com/drive/u/0/folders/1ABC_defGHIjklmnopqrstuv'),
    ).toBe('1ABC_defGHIjklmnopqrstuv')
  })

  it('accepts a bare ID', () => {
    expect(extractFolderId('1IkkIYY6PV-EukVsNbO_ySXLNJ7ofVfA1')).toBe(
      '1IkkIYY6PV-EukVsNbO_ySXLNJ7ofVfA1',
    )
  })

  it('trims surrounding whitespace', () => {
    expect(extractFolderId('  1ABCdefGhi-jklMNO_pq  ')).toBe('1ABCdefGhi-jklMNO_pq')
  })

  it('returns null for empty or junk input', () => {
    expect(extractFolderId('')).toBeNull()
    expect(extractFolderId('   ')).toBeNull()
    expect(extractFolderId('not-a-url')).toBeNull()
    expect(extractFolderId('https://example.com/something')).toBeNull()
  })
})

describe('extractFileId', () => {
  it('extracts from a /file/d/<id>/view URL', () => {
    expect(extractFileId('https://drive.google.com/file/d/1ABC123XYZ_abc/view')).toBe(
      '1ABC123XYZ_abc',
    )
  })

  it('extracts from a /file/d/<id>/preview URL', () => {
    expect(extractFileId('https://drive.google.com/file/d/1ABC123XYZ_abc/preview')).toBe(
      '1ABC123XYZ_abc',
    )
  })

  it('extracts from an ?id= style URL', () => {
    expect(extractFileId('https://drive.google.com/open?id=1ABC123XYZ_abc')).toBe(
      '1ABC123XYZ_abc',
    )
  })

  it('accepts a bare ID', () => {
    expect(extractFileId('1ABC123XYZ_abc_defGhi-jkl')).toBe('1ABC123XYZ_abc_defGhi-jkl')
  })

  it('returns null for non-Drive URLs', () => {
    expect(extractFileId('https://example.com/foo')).toBeNull()
    expect(extractFileId('')).toBeNull()
    expect(extractFileId('short')).toBeNull()
  })
})
