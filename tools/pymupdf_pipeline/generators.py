"""
Bank statement description generators — Python port of
transactionalDescriptionGenerator.js (ANZ, CBA, Westpac, ING, Bankwest,
Suncorp, Macquarie, RAMS, other).

Used by the PyMuPDF replace pipeline to inject bank-authentic synthetic
descriptions while reproducing layout geometry of the source PDF.
"""

from __future__ import annotations

import random
from typing import Callable

# ── Constants (mirrors transactionalDescriptionGenerator.js) ─────────────────

ANZ_MERCHANTS = [
    "WOOLWORTHS", "COLES", "ALDI", "IGA", "KFC", "MCDONALDS", "UBER EATS",
    "BP", "SHELL", "CALTEX", "WOOLWORTHS PETROL", "COLES EXPRESS",
    "APPLE.COM/BILL", "AMAZON MARKETPLACE", "DISNEY PLUS", "NETFLIX",
    "TELSTRA", "OPTUS", "ORIGIN ENERGY", "AGL", "COUNCIL RATES",
    "CHEMIST WAREHOUSE", "PRICELINE PHARMACY", "TERRY WHITE CHEMIST",
    "TARGET", "KMART", "BIG W", "JB HI FI", "REBEL SPORT",
    "WOOLWORTHS ONLINE", "COLES ONLINE", "AMAZON AU", "THE ICONIC",
    "WESTFIELD", "MYER", "DAVID JONES", "BUNNINGS", "OFFICEWORKS",
]
ANZ_PAYERS = [
    "SARAH JOHNSON", "MICHAEL CHEN", "EMILY WATSON", "DAVID NGUYEN",
    "RACHEL TAYLOR", "JAMES SMITH", "LISA BROWN", "ROBERT WILSON",
]
ANZ_CARDS = [
    "VISA DEBIT PURCHASE CARD 6294",
    "VISA DEBIT PURCHASE CARD 5076",
    "VISA CREDIT CARD 4567",
]
ANZ_BPAY_MERCHANTS = [
    "HOST PLUS", "L & H GROUP", "MM ELECTRICAL", "TAX OFFICE PAYMENT",
    "AGL STH AUST P/L", "DC STREAKY BAY", "ELGAS LIMITED", "COUNCIL RATES",
    "TELSTRA", "OPTUS", "ORIGIN ENERGY", "AGL ENERGY",
]
ANZ_PAYMENT_TARGETS = [
    "SARAH JOHNSON", "MICHAEL CHEN", "EMILY WATSON", "DAVID NGUYEN",
    "RACHEL TAYLOR", "JAMES SMITH", "LISA BROWN", "ROBERT WILSON",
    "TRANSFER TO SAVINGS", "INTERNAL TRANSFER",
]

CBA_NAMES = list(ANZ_PAYERS)
CBA_REFS = [
    "GROCERIES", "PETROL", "DINNER", "BILLS", "THANKS", "COFFEE",
    "FISH", "COIN", "SHARED", "RENT", "UTILITIES", "INTERNET",
]
CBA_APP_INCOME_OPTIONS = [
    "SALARY", "WAGES", "GOVERNMENT BENEFIT", "INVESTMENT INCOME",
    "PENSION", "OTHER INCOME",
]

WESTPAC_MERCHANTS = [
    "WOOLWORTHS", "COLES", "ALDI", "IGA", "KFC", "MCDONALDS", "HUNGRY JACKS",
    "BP", "SHELL", "CALTEX", "AMPOL", "7-ELEVEN",
    "APPLE.COM/BILL", "AMAZON MARKETPLACE", "DISNEY PLUS", "NETFLIX",
    "TELSTRA", "OPTUS", "VODAFONE", "ORIGIN ENERGY", "AGL",
    "CHEMIST WAREHOUSE", "PRICELINE PHARMACY", "TERRY WHITE CHEMIST",
    "TARGET", "KMART", "BIG W", "JB HI FI", "REBEL SPORT",
    "BUNNINGS", "OFFICEWORKS", "WESTFIELD", "MYER", "DAVID JONES",
]
WESTPAC_COUNTRIES = [
    "AUSTRALIA", "UNITED STATES", "UNITED KINGDOM", "NEW ZEALAND",
    "SINGAPORE", "JAPAN", "GERMANY", "FRANCE", "CANADA", "ITALY",
]

ING_MERCHANTS = list(WESTPAC_MERCHANTS[:37]) if False else [
    "WOOLWORTHS", "COLES", "ALDI", "IGA", "HARRIS FARM", "FOODLAND",
    "BP", "SHELL", "CALTEX", "AMPOL", "7-ELEVEN", "UNITED",
    "APPLE.COM/BILL", "AMAZON MARKETPLACE", "DISNEY PLUS", "NETFLIX",
    "TELSTRA", "OPTUS", "VODAFONE", "ORIGIN ENERGY", "AGL",
    "CHEMIST WAREHOUSE", "PRICELINE PHARMACY", "TERRY WHITE CHEMIST",
    "TARGET", "KMART", "BIG W", "JB HI FI", "REBEL SPORT",
    "BUNNINGS", "OFFICEWORKS", "WESTFIELD", "MYER", "DAVID JONES",
]
ING_INDIVIDUALS = list(ANZ_PAYERS)
ING_CARD_SUFFIX = "1234"
ING_SEQUENCE_PREFIX = "TXN"

BANKWEST_MERCHANTS = list(WESTPAC_MERCHANTS)
BANKWEST_CITIES = [
    "PERTH", "MELBOURNE", "SYDNEY", "BRISBANE", "ADELAIDE",
    "CANBERRA", "HOBART", "DARWIN", "GOLD COAST", "NEWCASTLE",
]
BANKWEST_POCKET_MONEY = [10, 20, 50, 100]

SUNCORP_MERCHANTS = list(WESTPAC_MERCHANTS)
SUNCORP_CITIES = [
    "BRISBANE", "MELBOURNE", "SYDNEY", "GOLD COAST", "CAIRNS",
    "TOWNSVILLE", "SUNSHINE COAST", "ROCKHAMPTON", "HOBART", "DARWIN",
]
SUNCORP_EFTPOS_CITIES = list(SUNCORP_CITIES)

MACQUARIE_PAYERS = list(ANZ_PAYERS)

RAMS_TRANSFER_TYPES = [
    "INTERNAL TRANSFER", "EXTERNAL TRANSFER", "BPAY", "DIRECT DEBIT",
    "DIRECT CREDIT", "WIRE TRANSFER", "INTERNATIONAL TRANSFER",
]
RAMS_INDIVIDUALS = list(ANZ_PAYERS)

OTHER_MERCHANTS = list(WESTPAC_MERCHANTS)
OTHER_SUNDERLAND_NAMES = ["SUNDERLAND A", "SUNDERLAND B", "SUNDERLAND C", "SUNDERLAND D"]
OTHER_SUNDERLAND_NOTES = [
    "RENT PAYMENT", "UTILITY PAYMENT", "INSURANCE PAYMENT", "LOAN REPAYMENT",
]
MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
CARD_NUMBERS = ["4532 1234 5678 9010"]


def pick(arr: list):
    return random.choice(arr)


def rand(min_v: int, max_v: int) -> int:
    return random.randint(min_v, max_v)


def pad2(n: int) -> str:
    return str(n).zfill(2)


def gen_anz() -> str:
    types: list[Callable[[], str]] = [
        lambda: f"PENDING - POS AUTHORISATION {pick(ANZ_MERCHANTS)} {pick(['STREAKY BAY','AU'])} AU Card Used {pick(ANZ_CARDS)}",
        lambda: f"PENDING - MTS {pick(ANZ_MERCHANTS)} Inv {rand(1000,9999)} {pick(ANZ_PAYERS).split()[-1]}",
        lambda: f"PENDING - EFTPOS {pick(ANZ_MERCHANTS)}",
        lambda: f"PENDING - PAYMENT FROM {pick(ANZ_PAYERS)} inv {rand(1000,9999)} MDE",
        lambda: f"VISA DEBIT PURCHASE CARD {pick(ANZ_CARDS)} {pick(ANZ_MERCHANTS)}",
        lambda: f"VISA DEBIT DEPOSIT {pick(ANZ_MERCHANTS)} {rand(30000000,39999999)}",
        lambda: f"PAYMENT TO {pick(ANZ_PAYMENT_TARGETS)} {rand(100000,999999)}",
        lambda: f"ANZ INTERNET BANKING BPAY {pick(ANZ_BPAY_MERCHANTS)} {{{rand(100000,999999)}}}",
        lambda: f"EFTPOS {pick(ANZ_MERCHANTS)} AU",
        lambda: f"ANZ MOBILE BANKING PAYMENT {rand(100000,999999)} TO {pick(ANZ_PAYERS)}",
        lambda: f"TRANSFER FROM {pick(ANZ_MERCHANTS)}",
        lambda: f"EFTPOS {pick(ANZ_MERCHANTS)} STREAKY BAY AU",
    ]
    return pick(types)()


def gen_cba() -> str:
    types = [
        lambda: f"Fast Transfer From {pick(CBA_NAMES)} {pick(CBA_REFS)} {rand(1,30)}/{rand(1,12)}/24",
        lambda: f"Fast Transfer From {pick(CBA_NAMES)} {pick(CBA_REFS)}",
        lambda: f"Transfer to xx{rand(1000,9999)} CommBank app {pick(CBA_APP_INCOME_OPTIONS)}".strip(),
        lambda: f"TAX OFFICE PAYMENTS NetBank BPAY 000000 {rand(100000000000000,999999999999999)}",
        lambda: f"Direct Debit 184534 World Gym Staffo A00E{rand(100000,999999)}1{rand(10,99)}{chr(65+rand(0,25))}{rand(10,99)}",
        lambda: f"Direct Credit 002962 CITIGROUP PTYLTD {pick(CBA_NAMES).split()[-1]}",
        lambda: f"Direct Credit 141000 {pick(CBA_NAMES)} {pick(CBA_REFS)}",
    ]
    return pick(types)()


def gen_westpac() -> str:
    def foreign():
        country = pick(WESTPAC_COUNTRIES)
        currency = "AUD"
        amount = f"{rand(100,5000)}.00" if True else f"{rand(100,5000):.2f}"
        amount = f"{rand(100, 5000) + random.random():.2f}"
        fee = f"{rand(1,10) + random.random():.2f}"
        city = pick(["CAPE TOWN", "HARTBEESPOOR", "SOMERSET WES", "JOHANNESBURG"])
        return (
            f"DEBIT CARD PURCHASE {pick(WESTPAC_MERCHANTS)} {city} {country} "
            f"{currency} {amount} incl. Foreign Transaction Fee AUD ${fee}"
        )

    types = [
        lambda: f"DEPOSIT WESTPAC BANKCORPDIRECT DR {rand(700000,799999)}",
        lambda: "INTEREST",
        foreign,
        lambda: f"DEBIT CARD PURCHASE {pick(WESTPAC_MERCHANTS)} {pick(['CAPE TOWN','HARTBEESPOOR'])} AUS",
    ]
    return pick(types)()


def gen_ing() -> str:
    def seq() -> str:
        return f"{ING_SEQUENCE_PREFIX}{rand(100000,999999)}"

    types = [
        lambda: f"Transfer from SAV 00299053 Mobile# {rand(560000000,569999999)}",
        lambda: f"VISA-{pick(ING_MERCHANTS)} AU#{ING_CARD_SUFFIX}({seq()}){' Apple Pay' if random.random()>0.5 else ''}",
        lambda: f"Ext Tfr - NET#{rand(1000000000,1099999999)} to {rand(47000000,47999999)} {pick(ING_INDIVIDUALS)} ING - ING Direct",
        lambda: f"VISA-APPLE.COM/BILL SYDNEY AU#{ING_CARD_SUFFIX}({seq()})",
        lambda: f"Debit Adjustment#{rand(900000,999999)}-Int Tran Fee - {pick(ING_MERCHANTS)}",
        lambda: f"VISA-{pick(ING_MERCHANTS)} AU#{ING_CARD_SUFFIX}({seq()})",
        lambda: f"EFT Declined #51 - {pick(ING_MERCHANTS)}",
    ]
    return pick(types)()


def gen_bankwest() -> str:
    types = [
        lambda: f"AUTHORISATION ONLY - EFTPOS PURCHASE AT {pick(BANKWEST_MERCHANTS)} {pick(BANKWEST_CITIES)} 000AU",
        lambda: f"{pick(BANKWEST_MERCHANTS)} {pick(['Melbourne','Mernda','Doreen','Preston'])} AUS",
        lambda: str(pick(BANKWEST_POCKET_MONEY)),
        lambda: f"{pick(BANKWEST_MERCHANTS)} {pick(['DOREEN','MELBOURNE','ELTHAM'])} AUS",
        lambda: f"MRS RHONDA IDA DO {pad2(rand(8,20))}:{pad2(rand(0,59))}AM {rand(1,30)}{pick(MONTHS)} Love Ra xx",
    ]
    return pick(types)()


def gen_suncorp() -> str:
    types = [
        lambda: f"VISA PURCHASE {pick(SUNCORP_MERCHANTS)} {pick(SUNCORP_CITIES)} {pad2(rand(1,30))}/{pad2(rand(1,12))} AU AUD",
        lambda: f"EFTPOS WDL {pick(SUNCORP_MERCHANTS)} {pick(SUNCORP_EFTPOS_CITIES)} AU",
        lambda: f"DIRECT DEBIT Suncorp Metway DIRECT DEBIT{rand(100000,999999)}",
        lambda: f"DIRECT CREDIT DIRECT CREDIT{rand(100000,999999)}TXN{rand(100000,999999)} {rand(100000,999999)}*HL",
        lambda: f"DIRECT CREDIT QLD DEPARTMENT O SALARY {rand(1000000,9999999)}",
        lambda: f"VISA PURCHASE {pick(SUNCORP_MERCHANTS)} {rand(100000,999999)} NV {rand(10,100) + random.random():.3f} USD",
    ]
    return pick(types)()


def gen_macquarie() -> str:
    types = [
        lambda: f"From {pick(MACQUARIE_PAYERS)} - Transfer",
        lambda: f"From {pick(MACQUARIE_PAYERS)} - CREDIT TO ACCOUNT",
        lambda: "Sign Up",
        lambda: f"to account xx{rand(1000,9999)}",
        lambda: f"From HOSTPLUS PENSION - 00{rand(5000000,5999999)}",
        lambda: "Funds transfer",
        lambda: f"from account xx{rand(1000,9999)}",
        lambda: "Interest charged",
        lambda: "Package fee",
    ]
    return pick(types)()


def gen_rams() -> str:
    transfer_type = pick(RAMS_TRANSFER_TYPES)
    types = [
        lambda: f"TRANSFER - {transfer_type}",
        lambda: f"Offset Benefit: {rand(10,60) + random.random():.2f}",
        lambda: "Normal Interest",
        lambda: f"{rand(5000000,6999999)}-01-{rand(5000000,6999999)}",
        lambda: str(rand(5000000, 6999999)),
        lambda: "Account now linked for Offset purposes",
        lambda: f"Rate Applicable: {rand(5,8) + random.random():.2f}% p.a.",
        lambda: pick(RAMS_INDIVIDUALS),
        lambda: "Account now delinked for Offset purposes",
    ]
    return pick(types)()


def gen_other() -> str:
    types = [
        lambda: f"VISA DEBIT PURCHASE CARD {pick(CARD_NUMBERS)} {pick(OTHER_MERCHANTS)}",
        lambda: "REVERSAL OF ACCOUNT SERVICING FEE MINIMUM $2000 IN DEPOSITS RECEIVED",
        lambda: "ACCOUNT SERVICING FEE",
        lambda: "EFTPOS MEDICARE BENEFIT",
        lambda: "EFTPOS PILOT\\",
        lambda: f"PAY/SALARY FROM J.J. RICHARDS &  {rand(10000,99999)}",
        lambda: "PAYMENT FROM TERRY BRADFORD,TERRY BRADFORD,Scott Sunderland,,,Wyndham 00201067381",
        lambda: f"ANZ MOBILE BANKING PAYMENT {rand(100000,999999)} TO {pick(OTHER_SUNDERLAND_NAMES)},MS KRISTY SUNDERLAND,{pick(OTHER_SUNDERLAND_NAMES)},,,{pick(OTHER_SUNDERLAND_NOTES)}",
        lambda: "PAYMENT TO HUMM BNPL        HUMM",
        lambda: f"ANZ M-BANKING FUNDS TFER TRANSFER {rand(100000,999999)}  FROM       {rand(100000000,999999999)}",
        lambda: f"TRANSFER FROM MCARE BENEFITS   {rand(100000000,999999999)} MCARE",
    ]
    return pick(types)()


GENERATORS: dict[str, Callable[[], str]] = {
    "anz": gen_anz,
    "cba": gen_cba,
    "commonwealth": gen_cba,
    "westpac": gen_westpac,
    "ing": gen_ing,
    "bankwest": gen_bankwest,
    "suncorp": gen_suncorp,
    "macquarie": gen_macquarie,
    "rams": gen_rams,
    "other": gen_other,
}

BANK_ALIASES = {
    "commbank": "cba",
    "cba": "cba",
    "commonwealth": "cba",
    "commonwealth bank": "cba",
    "anz": "anz",
    "westpac": "westpac",
    "ing": "ing",
    "bankwest": "bankwest",
    "suncorp": "suncorp",
    "macquarie": "macquarie",
    "rams": "rams",
    "other": "other",
    "generic": "other",
}


def normalize_bank(bank: str) -> str:
    key = (bank or "other").strip().lower()
    return BANK_ALIASES.get(key, key if key in GENERATORS else "other")


def generate_description(bank: str, seed: int | None = None) -> str:
    if seed is not None:
        random.seed(seed)
    fn = GENERATORS[normalize_bank(bank)]
    return fn()


def generate_descriptions(bank: str, count: int, seed: int | None = None) -> list[str]:
    if seed is not None:
        random.seed(seed)
    bank_key = normalize_bank(bank)
    fn = GENERATORS[bank_key]
    return [fn() for _ in range(count)]
