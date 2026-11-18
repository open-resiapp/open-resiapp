import type { UtilityProvider } from "./index";

// Every URL / hotline copied from the provider's official site on 2026-11-18
// (source page = outageUrl unless noted). Entries that could not be verified
// were left out on purpose — see README.md. hotline null = number not found
// on the official outage page (web form / contact page only).
export const SK_PROVIDERS: readonly UtilityProvider[] = [
  {
    id: "sk-bvs",
    utility: "water",
    name: "Bratislavská vodárenská spoločnosť",
    outageUrl: "https://www.bvsas.sk/poruchy-odstavky/",
    hotline: "0800 121 333",
    verifiedAt: "2026-11-18",
  },
  {
    id: "sk-zsvs",
    utility: "water",
    name: "Západoslovenská vodárenská spoločnosť",
    outageUrl: "https://www.zsvs.sk/poruchy-a-odstavky",
    hotline: null,
    verifiedAt: "2026-11-18",
  },
  {
    id: "sk-vvs",
    utility: "water",
    name: "Východoslovenská vodárenská spoločnosť",
    outageUrl: "https://www.vodarne.eu/zakaznicka-zona/kalendar-odstavok/planovane-odstavky",
    hotline: null,
    verifiedAt: "2026-11-18",
  },
  {
    id: "sk-pvs",
    utility: "water",
    name: "Podtatranská vodárenská spoločnosť",
    outageUrl: "https://pvpsas.sk/planovane-odstavky/",
    // Call centre; the official contact page says it also routes to fault dispatch.
    hotline: "0850 111 800",
    verifiedAt: "2026-11-18",
  },
  {
    id: "sk-zsd",
    utility: "electricity",
    name: "Západoslovenská distribučná",
    outageUrl: "https://www.zsdis.sk/odstavky-poruchy",
    hotline: "0800 111 567",
    verifiedAt: "2026-11-18",
  },
  {
    id: "sk-ssd",
    utility: "electricity",
    name: "Stredoslovenská distribučná",
    outageUrl: "https://www.ssd.sk/planovane-odstavky?page_id=4958",
    hotline: "0800 159 000",
    verifiedAt: "2026-11-18",
  },
  {
    id: "sk-vsd",
    utility: "electricity",
    name: "Východoslovenská distribučná",
    // Official fault-report page linked from vsds.sk ("Nahlásiť výpadok").
    outageUrl: "https://www.vypadokelektriny.sk",
    hotline: null,
    verifiedAt: "2026-11-18",
  },
  {
    id: "sk-spp-d",
    utility: "gas",
    name: "SPP - distribúcia",
    outageUrl:
      "https://www.spp-distribucia.sk/planovane-prerusenia-distribucie-zemneho-plynu-a-kalendar-najdolezitejsich-vykopovych-prac/",
    hotline: "0850 111 727",
    verifiedAt: "2026-11-18",
  },
];
