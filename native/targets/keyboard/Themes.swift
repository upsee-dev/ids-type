import Foundation

// 自動生成: core/data/themes.ts から web の build:data が書き出す。直接編集しないこと。
enum Themes {
    struct Palette {
        let key: String
        let label: String
        let dark: Bool
        let bg: UInt32
        let card: UInt32
        let keyFill: UInt32
        let border: UInt32
        let text: UInt32
        let sub: UInt32
        let faint: UInt32
        let accent: UInt32
        let accentBg: UInt32
        let onAccent: UInt32
    }

    static let all: [Palette] = [
        Palette(key: "standard", label: "スタンダード", dark: false, bg: 0xFAFAF9, card: 0xFFFFFF, keyFill: 0xFAFAF9, border: 0xE7E5E4, text: 0x1C1917, sub: 0x78716C, faint: 0xA8A29E, accent: 0x4F46E5, accentBg: 0xEEF2FF, onAccent: 0xFFFFFF),
        Palette(key: "sakura", label: "サクラ", dark: false, bg: 0xFDF2F8, card: 0xFFFFFF, keyFill: 0xFDF2F8, border: 0xFBCFE8, text: 0x4A1D31, sub: 0xA34D6E, faint: 0xCE9CB0, accent: 0xDB2777, accentBg: 0xFCE7F3, onAccent: 0xFFFFFF),
        Palette(key: "soda", label: "ソーダ", dark: false, bg: 0xECFEFF, card: 0xFFFFFF, keyFill: 0xECFEFF, border: 0xA5F3FC, text: 0x164E63, sub: 0x45788A, faint: 0x85AEBB, accent: 0x0E7490, accentBg: 0xCFFAFE, onAccent: 0xFFFFFF),
        Palette(key: "himawari", label: "ヒマワリ", dark: false, bg: 0xFFFBEB, card: 0xFFFFFF, keyFill: 0xFFFBEB, border: 0xFDE68A, text: 0x451A03, sub: 0x93702B, faint: 0xC0A566, accent: 0xB45309, accentBg: 0xFEF3C7, onAccent: 0xFFFFFF),
        Palette(key: "matcha", label: "マッチャ", dark: false, bg: 0xF0FDF4, card: 0xFFFFFF, keyFill: 0xF0FDF4, border: 0xBBF7D0, text: 0x14532D, sub: 0x4D7C5F, faint: 0x8FBA9E, accent: 0x15803D, accentBg: 0xDCFCE7, onAccent: 0xFFFFFF),
        Palette(key: "dark", label: "ダーク", dark: true, bg: 0x0C0A09, card: 0x1C1917, keyFill: 0x0C0A09, border: 0x292524, text: 0xE7E5E4, sub: 0xA8A29E, faint: 0x78716C, accent: 0x818CF8, accentBg: 0x1E1B4B, onAccent: 0xFFFFFF),
        Palette(key: "yozora", label: "ヨゾラ", dark: true, bg: 0x0F172A, card: 0x1E293B, keyFill: 0x0F172A, border: 0x334155, text: 0xE2E8F0, sub: 0x94A3B8, faint: 0x64748B, accent: 0xA78BFA, accentBg: 0x312E81, onAccent: 0x1E1B4B),
    ]

    static let autoLight = "standard"
    static let autoDark = "dark"

    /// key からテーマを引く。"auto"・不明な key は nil(呼び出し側でおまかせ扱い)
    static func palette(_ key: String?) -> Palette? {
        all.first { $0.key == key }
    }
}
