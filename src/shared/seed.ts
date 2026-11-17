import { uid } from './calc'
import type {
  Account,
  Block,
  BlockType,
  FieldRow,
  HeaderConfig,
  PageConfig,
  PickedImage,
  QDoc,
  Settings,
  TextBlock
} from './types'

export const SEED_ACCOUNT_ID = 'acc-default'

export function defaultSettings(now = new Date()): Settings {
  const account: Account = {
    id: SEED_ACCOUNT_ID,
    name: 'Sampath Bank - Tangalle',
    holder: 'Santop Gleam Service',
    number: '011610000940',
    bank: 'Sampath Bank Plc',
    branch: 'Tangalle'
  }
  return {
    schema: 1,
    accounts: [account],
    defaultAccountId: account.id,
    numbering: {
      auto: true,
      prefix: 'MT-',
      includeYear: true,
      yearlyReset: true,
      digits: 4,
      // The reference quotation is MT-260017, so numbering continues from 18.
      nextSeq: 18,
      seqYear: now.getFullYear()
    },
    lastTemplateId: null
  }
}

export function defaultPage(): PageConfig {
  return {
    marginTop: 42.5,
    marginBottom: 20,
    marginLeft: 25.4,
    marginRight: 25.4,
    footerText: 'This is a computer-generated document. No signature required.',
    footerBottom: 12.4
  }
}

export type TextPreset = 'title' | 'heading' | 'body' | 'note'

export const TEXT_PRESETS: Record<TextPreset, Pick<TextBlock, 'size' | 'bold' | 'color' | 'align'>> = {
  title: { size: 20, bold: true, color: '#000000', align: 'left' },
  heading: { size: 9, bold: true, color: '#000000', align: 'left' },
  body: { size: 9, bold: false, color: '#000000', align: 'left' },
  note: { size: 9, bold: false, color: '#a6a6a6', align: 'left' }
}

function field(label: string, value = '', extra: Partial<FieldRow> = {}): FieldRow {
  return { id: uid(), label, value, bold: false, bind: null, ...extra }
}

export function textBlock(text: string, preset: TextPreset, extra: Partial<TextBlock> = {}): TextBlock {
  return { id: uid(), type: 'text', spaceBefore: 0, text, ...TEXT_PRESETS[preset], ...extra }
}

/** A fresh block of the given type, used by the "add section" menu. */
export function newBlock(type: BlockType, preset: TextPreset = 'body'): Block {
  switch (type) {
    case 'text':
      return textBlock('', preset, { spaceBefore: 2 })
    case 'fields':
      return {
        id: uid(),
        type: 'fields',
        spaceBefore: 2,
        left: [field('Label:')],
        right: [field('Label:')],
        split: 88.65,
        leftLabelWidth: 29.7,
        rightLabelWidth: 16.1,
        size: 9
      }
    case 'items':
      return {
        id: uid(),
        type: 'items',
        spaceBefore: 2.3,
        descriptionLabel: 'Description',
        qtyLabel: 'Qty',
        amountLabel: 'Amount (LKR)',
        totalLabel: 'Total',
        rows: [{ id: uid(), description: '', qty: '1', price: '' }],
        hideRowAmounts: false,
        size: 9
      }
    case 'list':
      return { id: uid(), type: 'list', spaceBefore: 0, items: [{ id: uid(), text: '' }], size: 8, color: '#000000' }
    case 'images':
      return {
        id: uid(),
        type: 'images',
        spaceBefore: 1.3,
        images: [],
        height: 41.5,
        gap: 1,
        align: 'center',
        showCaption: false,
        caption: ''
      }
    case 'account':
      return { id: uid(), type: 'account', spaceBefore: 2, heading: 'Account Details:', size: 9 }
  }
}

export interface SeedAssets {
  background: PickedImage
  logo: PickedImage
  iconLocation: PickedImage
  iconEmail: PickedImage
  iconPhone: PickedImage
  photoOutside: PickedImage
  photoInside: PickedImage
}

function stamp(): Pick<QDoc, 'createdAt' | 'updatedAt'> {
  const now = new Date().toISOString()
  return { createdAt: now, updatedAt: now }
}

/** The built-in "Mobile Washroom" quotation design, rebuilt from the reference document. */
export function buildDefaultTemplate(a: SeedAssets, accountId: string | null): QDoc {
  const header: HeaderConfig = {
    background: a.background.asset,
    logos: [
      {
        id: uid(),
        asset: a.logo.asset,
        x: 12.66,
        y: 9.58,
        width: 31.83,
        ratio: a.logo.height / a.logo.width
      }
    ],
    companyName: 'Santop Mobile Toilet',
    lines: [
      { id: uid(), icon: a.iconLocation.asset, text: 'No.52, Galle Road, Colombo 03' },
      { id: uid(), icon: a.iconEmail.asset, text: 'info@mobilewashroom.lk' },
      { id: uid(), icon: a.iconPhone.asset, text: '+94 777 69 44 55, +94 777 694 456' }
    ],
    detailsTop: 5.5,
    detailsRight: 5.35
  }

  const item = (description: string, qty: string) => ({ id: uid(), description, qty, price: '' })
  const bullet = (text: string) => ({ id: uid(), text })

  const blocks: Block[] = [
    textBlock('QUOTATION', 'title', { spaceBefore: 1.1 }),
    {
      id: uid(),
      type: 'fields',
      spaceBefore: 1.35,
      left: [
        field('Date', '', { bind: 'date' }),
        field('Quotation No.:', '', { bind: 'number' }),
        field('Event', '', { bold: true }),
        field('Location:'),
        field('Date:')
      ],
      right: [
        field('Name:', '', { bind: 'customer' }),
        field('Address:'),
        field('Contact:'),
        field('Email:'),
        field('Time:')
      ],
      split: 88.65,
      leftLabelWidth: 29.7,
      rightLabelWidth: 16.1,
      size: 9
    },
    {
      id: uid(),
      type: 'items',
      spaceBefore: 2.3,
      descriptionLabel: 'Description',
      qtyLabel: 'Qty',
      amountLabel: 'Amount (LKR)',
      totalLabel: 'Total',
      rows: [
        item('Portable Toilets for 01 day', '10'),
        item('Transportation', '1'),
        item('Assembling & plumbing charges', '1'),
        item('Water bowser service', '1'),
        item('Water tank and square folding', '1'),
        item('Gully bowser', '1'),
        item('Janitorial service with chemical', '1'),
        item('Toilet tissues, hand soap, and other essential consumables', '1')
      ],
      hideRowAmounts: false,
      size: 9
    },
    textBlock('We are pleased to quote a sum of Rs. {total} for the above contract.', 'body', {
      size: 10,
      align: 'center',
      spaceBefore: 4.4
    }),
    textBlock('Note: These prices are valid only for the quantities requested in this quotation.', 'note'),
    textBlock('DETAILS OF BRANDNEW PORTABLE TOILET', 'heading', { size: 8, spaceBefore: 2.9 }),
    {
      id: uid(),
      type: 'list',
      spaceBefore: 0.15,
      items: [
        bullet('Size of each is (L*W*H) 1170 * 1170 * 2300 mm.'),
        bullet('Weight is 130 kg'),
        bullet('Clean Water-130L & Waste Water-290L.'),
        bullet('Material-HDPE & UV.'),
        bullet(
          'Included Special Items- Urinal, Up flush type, Air Freshener dispenser, Bidder shower, Lifting rings, Hook, Light, Ventilation Fan, Toilet paper roller, Valve'
        )
      ],
      size: 8,
      color: '#000000'
    },
    {
      id: uid(),
      type: 'images',
      spaceBefore: 1,
      images: [
        { id: uid(), asset: a.photoOutside.asset, ratio: a.photoOutside.width / a.photoOutside.height },
        { id: uid(), asset: a.photoInside.asset, ratio: a.photoInside.width / a.photoInside.height }
      ],
      height: 41.5,
      gap: 1,
      align: 'center',
      showCaption: true,
      caption: 'With septic tank-commode type'
    },
    { id: uid(), type: 'account', spaceBefore: 0, heading: 'Account Details:', size: 9 },
    textBlock(
      'We trust the information provided in our quotation is in line with your requirements. And looking forward to the opportunity to service your needs and become a valued partner.\nIf you need further clarification in this regard, please contact us on 0777 69 44 55',
      'body',
      { color: '#808080', align: 'justify', spaceBefore: 4.9 }
    )
  ]

  return {
    schema: 1,
    id: uid(),
    kind: 'template',
    name: 'Mobile Washroom Quotation',
    number: '',
    date: '',
    accountId,
    header,
    page: defaultPage(),
    blocks,
    ...stamp()
  }
}

/** An empty design: no artwork, just a title, the details grid and an items table. */
export function buildBlankTemplate(accountId: string | null): QDoc {
  return {
    schema: 1,
    id: uid(),
    kind: 'template',
    name: 'Untitled template',
    number: '',
    date: '',
    accountId,
    header: { background: null, logos: [], companyName: 'Company name', lines: [], detailsTop: 8, detailsRight: 15 },
    page: { ...defaultPage(), marginTop: 30 },
    blocks: [
      textBlock('QUOTATION', 'title'),
      {
        id: uid(),
        type: 'fields',
        spaceBefore: 2,
        left: [field('Date', '', { bind: 'date' }), field('Quotation No.:', '', { bind: 'number' })],
        right: [field('Name:', '', { bind: 'customer' }), field('Address:')],
        split: 88.65,
        leftLabelWidth: 29.7,
        rightLabelWidth: 16.1,
        size: 9
      },
      newBlock('items'),
      newBlock('account')
    ],
    ...stamp()
  }
}
