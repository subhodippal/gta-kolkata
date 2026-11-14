"""Curated list of Kolkata's famous / viral / historic places (food, sweets, hotels, buildings, malls, sights, ghats,
temples, markets, sports grounds).  Locations are resolved from open data only, in this order:
  1. OpenStreetMap elements in osm_raw/cell_*.json (by name)   2. Wikidata (osm_raw/wikidata.json, by label)
  3. Nominatim (OpenStreetMap's geocoder, 1 request / second, bounded to the game region)
Output: osm_raw/famous.json  [{key, en, bn, kind, lat, lon, src, desc, bndesc, img?}]
usage: python3 tools/famous.py osm_raw"""
import glob, json, os, re, sys, time, urllib.parse, urllib.request

# (search name, kind, english note, bengali note[, nominatim query])
FAMOUS = [
    # ---- legendary restaurants & food
    ("Peter Cat", "food", "Park Street restaurant famous for its Chelo Kebab since 1975", "চেলো কাবাবের জন্য বিখ্যাত পার্ক স্ট্রিটের রেস্তোরাঁ (১৯৭৫)"),
    ("Mocambo", "food", "Classic Park Street restaurant, continental food since 1956", "১৯৫৬ সাল থেকে পার্ক স্ট্রিটের ক্লাসিক কন্টিনেন্টাল রেস্তোরাঁ"),
    ("Flurys", "food", "Iconic Swiss tea room & bakery on Park Street (1927)", "পার্ক স্ট্রিটের বিখ্যাত সুইস টি-রুম ও বেকারি (১৯২৭)"),
    ("Trincas", "food", "Park Street restaurant with live music since the 1960s", "লাইভ গানের জন্য বিখ্যাত পার্ক স্ট্রিটের রেস্তোরাঁ"),
    ("Arsalan", "food", "Hugely popular Kolkata biryani (Park Circus)", "কলকাতার জনপ্রিয় বিরিয়ানি — আরসালান"),
    ("Aminia", "food", "Old favourite for Kolkata biryani & mughlai near New Market", "নিউ মার্কেটের কাছে পুরনো বিরিয়ানি ও মোগলাই খাবারের দোকান"),
    ("Royal Indian Hotel", "food", "Chitpur's 1905 eatery famous for chaap & biryani", "চিৎপুরের ১৯০৫ সালের রয়্যাল — চাপ ও বিরিয়ানির জন্য বিখ্যাত"),
    ("Shiraz Golden Restaurant", "food", "Famous mughlai & biryani at Mullick Bazar", "মল্লিকবাজারের বিখ্যাত মোগলাই ও বিরিয়ানি"),
    ("Nizam's", "food", "Birthplace of the Kolkata kathi roll (1932)", "কলকাতার কাঠি রোলের জন্মস্থান — নিজাম (১৯৩২)"),
    ("Zeeshan", "food", "Popular Park Circus biryani & kebab spot", "পার্ক সার্কাসের জনপ্রিয় বিরিয়ানি ও কাবাব"),
    ("Indian Coffee House", "food", "College Street adda since 1942 — writers, students, coffee", "কলেজ স্ট্রিটের কফি হাউস — আড্ডার জায়গা (১৯৪২)"),
    ("Paramount", "food", "College Square sherbet shop since 1918 (daab sherbet)", "কলেজ স্কোয়ারের প্যারামাউন্ট — ডাবের শরবত (১৯১৮)"),
    ("Putiram", "food", "Century-old College Street shop for kachori & sweets", "কলেজ স্ট্রিটের শতাব্দী প্রাচীন পুঁটিরাম — কচুরি ও মিষ্টি"),
    ("Mitra Cafe", "food", "Shobhabazar cabin famous for fish & mutton cutlets", "শোভাবাজারের মিত্র ক্যাফে — কাটলেট ও ফিশ ফ্রাই"),
    ("Anadi Cabin", "food", "Esplanade's legendary mughlai paratha", "ধর্মতলার অনাদি কেবিন — বিখ্যাত মোগলাই পরোটা"),
    ("Allen Kitchen", "food", "Tiny 1890s shop famous for prawn cutlets", "১৮৯০-এর অ্যালেন কিচেন — চিংড়ির কাটলেট"),
    ("Niranjan Agar", "food", "Girish Park's old cabin for egg devil & cutlets", "গিরিশ পার্কের নিরঞ্জন আগার — ডিমের ডেভিল ও কাটলেট"),
    ("Golbari", "food", "Shyambazar's legendary kosha mangsho", "শ্যামবাজারের গোলবাড়ি — বিখ্যাত কষা মাংস"),
    ("Bhojohori Manna", "food", "Popular Bengali cuisine chain", "জনপ্রিয় বাঙালি খাবারের রেস্তোরাঁ — ভজহরি মান্না"),
    ("6 Ballygunge Place", "food", "Well-known Bengali fine dining", "বিখ্যাত বাঙালি রেস্তোরাঁ — ৬ বালিগঞ্জ প্লেস"),
    ("Kewpie's", "food", "Home-style Bengali food in a family house", "বাড়ির মতো বাঙালি খাবার — কিউপিজ"),
    ("Oh! Calcutta", "food", "Celebrated Bengali restaurant", "বিখ্যাত বাঙালি রেস্তোরাঁ — ওহ! ক্যালকাটা"),
    ("Chung Wah", "food", "One of the oldest Chinese restaurants (Central Avenue)", "কলকাতার সবচেয়ে পুরনো চাইনিজ রেস্তোরাঁগুলির একটি"),
    ("Eau Chew", "food", "Family-run Chinese restaurant since 1925", "১৯২৫ সালের পারিবারিক চাইনিজ রেস্তোরাঁ — ইউ চিউ"),
    ("Kusum Rolls", "food", "Park Street's famous kathi rolls", "পার্ক স্ট্রিটের বিখ্যাত রোল — কুসুম"),
    ("Tiretta Bazaar", "food", "Old Chinatown's early-morning Chinese breakfast street", "টেরিটি বাজার — ভোরের চাইনিজ ব্রেকফাস্ট"),
    ("Dacres Lane", "food", "Esplanade street-food lane (stew, chicken, rice)", "ধর্মতলার স্ট্রিট-ফুড গলি — ডেকার্স লেন"),
    ("Bedouin", "food", "Gariahat favourite for rolls & mughlai", "গড়িয়াহাটের রোল ও মোগলাই — বেদুইন"),
    ("Haldiram", "food", "Sweets & snacks chain", "মিষ্টি ও স্ন্যাকস — হলদিরাম"),
    # ---- sweets (mishti)
    ("Bhim Chandra Nag", "sweets", "Bowbazar sweet shop since 1826 — ledikeni", "১৮২৬ সালের বউবাজারের ভীম চন্দ্র নাগ — লেডিকেনি"),
    ("Girish Chandra Dey & Nakur Chandra Nandy", "sweets", "Legendary sandesh makers since 1844", "১৮৪৪ সাল থেকে বিখ্যাত সন্দেশ — গিরীশ ও নকুড়"),
    ("Balaram Mullick & Radharaman Mullick", "sweets", "Famous sandesh & mishti doi (Bhowanipore)", "ভবানীপুরের বলরাম মল্লিক — সন্দেশ ও মিষ্টি দই"),
    ("K.C. Das", "sweets", "Inventors of the canned rosogolla (Esplanade)", "রসগোল্লার কে.সি. দাস (ধর্মতলা)"),
    ("Ganguram", "sweets", "Old sweet-shop chain since 1885", "১৮৮৫ সালের মিষ্টির দোকান — গাঙ্গুরাম"),
    ("Banchharam", "sweets", "Popular mishti chain", "জনপ্রিয় মিষ্টির দোকান — বাঞ্ছারাম"),
    ("Sen Mahasay", "sweets", "Shyambazar sweet shop since 1910s", "শ্যামবাজারের সেন মহাশয় — মিষ্টি"),
    ("Nobin Chandra Das", "sweets", "Bagbazar — the family credited with the rosogolla", "বাগবাজারের নবীন চন্দ্র দাস — রসগোল্লার জনক"),
    # ---- hotels
    ("ITC Royal Bengal", "hotel", "Luxury hotel tower near the EM Bypass", "ইএম বাইপাসের বিলাসবহুল আইটিসি রয়্যাল বেঙ্গল"),
    ("ITC Sonar", "hotel", "Luxury resort-style hotel on the EM Bypass", "ইএম বাইপাসের আইটিসি সোনার"),
    ("Taj Bengal", "hotel", "Luxury hotel at Alipore", "আলিপুরের তাজ বেঙ্গল"),
    ("The Oberoi Grand", "hotel", "Heritage 'Grande Dame' of Chowringhee", "চৌরঙ্গীর ঐতিহ্যবাহী ওবেরয় গ্র্যান্ড"),
    ("JW Marriott Kolkata", "hotel", "Luxury hotel on the EM Bypass", "জেডব্লিউ ম্যারিয়ট কলকাতা"),
    ("Hyatt Regency Kolkata", "hotel", "Hotel in Salt Lake", "সল্টলেকের হায়াত রিজেন্সি"),
    ("Novotel Kolkata", "hotel", "Hotel in New Town", "নিউ টাউনের নোভোটেল"),
    ("The Westin Kolkata Rajarhat", "hotel", "Hotel in New Town", "নিউ টাউনের ওয়েস্টিন"),
    ("Taj City Centre New Town", "hotel", "Hotel in New Town", "নিউ টাউনের তাজ সিটি সেন্টার"),
    ("The Lalit Great Eastern", "hotel", "One of Asia's oldest hotels (1840s), Dalhousie", "এশিয়ার অন্যতম প্রাচীন হোটেল (১৮৪০)"),
    ("The Park", "hotel", "Park Street hotel & nightlife hub", "পার্ক স্ট্রিটের দ্য পার্ক হোটেল"),
    ("Kenilworth Hotel", "hotel", "Little Russell Street hotel", "কেনিলওয়ার্থ হোটেল"),
    # ---- buildings & offices
    ("The 42", "building", "Kolkata's tallest building (~260 m), Chowringhee", "কলকাতার সবচেয়ে উঁচু বাড়ি — দ্য ৪২ (প্রায় ২৬০ মি)"),
    ("Chatterjee International Centre", "building", "Classic Chowringhee office tower", "চৌরঙ্গীর চ্যাটার্জি ইন্টারন্যাশনাল সেন্টার"),
    ("Tata Centre", "building", "Office tower on Chowringhee Road", "চৌরঙ্গীর টাটা সেন্টার"),
    ("South City Towers", "building", "Twin residential towers at Prince Anwar Shah Road", "সাউথ সিটির উঁচু আবাসন"),
    ("Urbana", "building", "Tall residential towers on the EM Bypass", "ইএম বাইপাসের আরবানা টাওয়ার"),
    ("Infinity Benchmark", "building", "IT tower in Salt Lake Sector V", "সেক্টর ফাইভের ইনফিনিটি বেঞ্চমার্ক"),
    ("DLF IT Park", "building", "IT park in New Town", "নিউ টাউনের ডিএলএফ আইটি পার্ক"),
    ("Ecospace", "building", "Business park in New Town", "নিউ টাউনের ইকোস্পেস"),
    ("TCS Gitanjali Park", "building", "TCS campus in New Town", "নিউ টাউনের টিসিএস গীতাঞ্জলি পার্ক"),
    ("Nabanna", "building", "West Bengal state secretariat (Howrah)", "পশ্চিমবঙ্গ সরকারের সচিবালয় — নবান্ন"),
    ("Lalbazar", "building", "Kolkata Police headquarters", "কলকাতা পুলিশের সদর দপ্তর — লালবাজার"),
    ("Calcutta High Court", "building", "Gothic high court building (1872)", "কলকাতা হাইকোর্ট (১৮৭২)"),
    ("Raj Bhavan", "building", "Governor's house (1803)", "রাজভবন (১৮০৩)"),
    ("Town Hall", "building", "Doric-style Town Hall (1813)", "কলকাতা টাউন হল (১৮১৩)"),
    ("Biswa Bangla Convention Centre", "building", "Convention centre in New Town", "নিউ টাউনের বিশ্ব বাংলা কনভেনশন সেন্টার"),
    # ---- malls & markets
    ("South City Mall", "mall", "One of the biggest malls in Kolkata", "কলকাতার অন্যতম বড় মল — সাউথ সিটি"),
    ("Quest Mall", "mall", "Luxury mall at Park Circus", "পার্ক সার্কাসের কোয়েস্ট মল"),
    ("Acropolis Mall", "mall", "Mall at Kasba", "কসবার অ্যাক্রোপলিস মল"),
    ("City Centre Salt Lake", "mall", "Open-plan mall in Salt Lake", "সল্টলেক সিটি সেন্টার"),
    ("Axis Mall", "mall", "Mall in New Town", "নিউ টাউনের অ্যাক্সিস মল"),
    ("Mani Square", "mall", "Mall on the EM Bypass", "ইএম বাইপাসের মণি স্কোয়ার"),
    ("Forum Mall", "mall", "Mall on Elgin Road", "এলগিন রোডের ফোরাম মল"),
    ("College Street", "market", "Boi Para — the world's largest second-hand book market", "বইপাড়া — পৃথিবীর বৃহত্তম পুরনো বইয়ের বাজার"),
    ("Burrabazar", "market", "One of Asia's largest wholesale markets", "এশিয়ার অন্যতম বৃহত্তম পাইকারি বাজার — বড়বাজার"),
    ("Gariahat Market", "market", "South Kolkata shopping hub", "দক্ষিণ কলকাতার গড়িয়াহাট বাজার"),
    ("Mallick Ghat Flower Market", "market", "Huge riverside flower market under Howrah Bridge", "হাওড়া ব্রিজের নিচে মল্লিকঘাট ফুলবাজার"),
    ("Kumartuli", "sight", "Potters' quarter where Durga idols are made", "কুমোরটুলি — দুর্গা প্রতিমা তৈরির পাড়া"),
    ("Hatibagan Market", "market", "North Kolkata shopping street", "উত্তর কলকাতার হাতিবাগান বাজার"),
    ("Shyambazar Five Point Crossing", "sight", "Five-road crossing with Netaji's horse statue", "শ্যামবাজার পাঁচমাথার মোড় — নেতাজির মূর্তি"),
    # ---- sights & culture
    ("Prinsep Ghat", "ghat", "Palladian memorial (1843) by the river under Vidyasagar Setu", "বিদ্যাসাগর সেতুর নিচে প্রিন্সেপ ঘাট (১৮৪৩)"),
    ("Indian Museum", "sight", "India's oldest museum (1814)", "ভারতের প্রাচীনতম জাদুঘর (১৮১৪)"),
    ("Science City", "sight", "Large science museum & park", "বিজ্ঞান নগরী — সায়েন্স সিটি"),
    ("Birla Planetarium", "sight", "Planetarium on Chowringhee", "বিড়লা তারামণ্ডল"),
    ("Marble Palace", "sight", "19th-century mansion full of marble & art", "উনিশ শতকের মার্বেল প্যালেস"),
    ("Jorasanko Thakur Bari", "sight", "Rabindranath Tagore's ancestral house", "রবীন্দ্রনাথ ঠাকুরের জোড়াসাঁকো ঠাকুরবাড়ি"),
    ("Mother House", "sight", "Missionaries of Charity — Mother Teresa's home", "মাদার টেরেসার মাদার হাউস"),
    ("Alipore Zoological Garden", "sight", "India's oldest zoo (1876)", "আলিপুর চিড়িয়াখানা (১৮৭৬)"),
    ("Millennium Park", "sight", "Riverside park on Strand Road", "স্ট্র্যান্ড রোডের মিলেনিয়াম পার্ক"),
    ("Eco Park", "sight", "Huge urban park in New Town (Prakriti Tirtha)", "নিউ টাউনের ইকো পার্ক (প্রকৃতি তীর্থ)"),
    ("Mother's Wax Museum", "sight", "Wax museum in New Town", "নিউ টাউনের মাদার্স ওয়াক্স মিউজিয়াম"),
    ("Nicco Park", "sight", "Amusement park in Salt Lake", "সল্টলেকের নিক্কো পার্ক"),
    ("Aquatica", "sight", "Water park", "অ্যাকোয়াটিকা ওয়াটার পার্ক"),
    ("Rabindra Sarobar", "sight", "Lake & park in south Kolkata", "দক্ষিণ কলকাতার রবীন্দ্র সরোবর"),
    ("Netaji Bhawan", "sight", "Netaji Subhas Chandra Bose's house", "নেতাজি সুভাষচন্দ্র বসুর বাড়ি — নেতাজি ভবন"),
    ("Nandan", "sight", "Film centre near Rabindra Sadan", "নন্দন চলচ্চিত্র কেন্দ্র"),
    ("Academy of Fine Arts", "sight", "Art gallery & theatre", "অ্যাকাডেমি অফ ফাইন আর্টস"),
    ("Rabindra Tirtha", "sight", "Tagore cultural centre in New Town", "নিউ টাউনের রবীন্দ্র তীর্থ"),
    ("Metcalfe Hall", "sight", "Greek-revival heritage hall (1844)", "মেটকাফ হল (১৮৪৪)"),
    ("Fort William", "sight", "18th-century British fort on the Maidan", "ময়দানের ফোর্ট উইলিয়াম"),
    ("Botanical Garden", "sight", "Shibpur garden with the Great Banyan tree", "শিবপুর বোটানিক্যাল গার্ডেন — মহাবট"),
    # ---- Eco Park seven wonders
    ("Replica of Taj Mahal", "wonder", "Eco Park Seven Wonders: Taj Mahal replica", "ইকো পার্কের সপ্তাশ্চর্য: তাজমহলের প্রতিরূপ", "Taj Mahal replica Eco Park New Town"),
    ("Replica of Roman Colosseum", "wonder", "Eco Park Seven Wonders: Colosseum replica", "ইকো পার্কের সপ্তাশ্চর্য: কলোসিয়ামের প্রতিরূপ", "Colosseum replica Eco Park"),
    ("Replica of Great Wall of China", "wonder", "Eco Park Seven Wonders: Great Wall replica", "ইকো পার্কের সপ্তাশ্চর্য: চীনের প্রাচীরের প্রতিরূপ", "Great Wall replica Eco Park"),
    ("Moai Statues", "wonder", "Eco Park Seven Wonders: Easter Island Moai", "ইকো পার্কের সপ্তাশ্চর্য: মোয়াই মূর্তি", "Moai Eco Park New Town"),
    ("Replica of Christ the Redeemer", "wonder", "Eco Park Seven Wonders: Christ the Redeemer", "ইকো পার্কের সপ্তাশ্চর্য: ক্রাইস্ট দ্য রিডিমার", "Christ the Redeemer replica Eco Park"),
    ("Replica of Great Pyramid of Giza", "wonder", "Eco Park Seven Wonders: Pyramid replica", "ইকো পার্কের সপ্তাশ্চর্য: পিরামিডের প্রতিরূপ", "Pyramid replica Eco Park"),
    ("Replica of Petra", "wonder", "Eco Park Seven Wonders: Petra replica", "ইকো পার্কের সপ্তাশ্চর্য: পেত্রার প্রতিরূপ", "Petra replica Eco Park"),
    ("Replica of Chichen Itza", "wonder", "Eco Park Seven Wonders: Chichen Itza replica", "ইকো পার্কের সপ্তাশ্চর্য: চিচেন ইৎজার প্রতিরূপ", "Chichen Itza replica Eco Park"),
    # ---- temples, churches, mosques
    ("Kalighat Kali Temple", "worship", "One of the 51 Shakti Peethas", "৫১ সতীপীঠের অন্যতম কালীঘাট মন্দির"),
    ("Belur Math", "worship", "Headquarters of the Ramakrishna Mission", "রামকৃষ্ণ মিশনের প্রধান কার্যালয় — বেলুড় মঠ"),
    ("Birla Mandir", "worship", "White marble Lakshmi-Narayan temple", "সাদা মার্বেলের বিড়লা মন্দির"),
    ("Pareshnath Jain Temple", "worship", "Ornate 19th-century Jain temple", "পরেশনাথ জৈন মন্দির"),
    ("ISKCON", "worship", "ISKCON temple, Albert Road", "ইসকন মন্দির"),
    ("Thanthania Kalibari", "worship", "Old Kali temple on Bidhan Sarani (1703)", "ঠনঠনিয়া কালীবাড়ি (১৭০৩)"),
    ("Lake Kalibari", "worship", "Kali temple near Rabindra Sarobar", "লেক কালীবাড়ি"),
    ("Chinese Kali Temple", "worship", "Tangra's Kali temple tended by the Chinese community", "ট্যাংরার চাইনিজ কালী মন্দির"),
    ("Tipu Sultan Mosque", "worship", "Dharmatala mosque (1842)", "ধর্মতলার টিপু সুলতান মসজিদ (১৮৪২)"),
    ("Armenian Church", "worship", "Church of Holy Nazareth (1724)", "আর্মেনিয়ান চার্চ (১৭২৪)"),
    ("St. John's Church", "worship", "Kolkata's first cathedral (1787)", "সেন্ট জন্স চার্চ (১৭৮৭)"),
    ("Magen David Synagogue", "worship", "Grand synagogue (1884)", "মাগেন ডেভিড সিনাগগ (১৮৮৪)"),
    # ---- ghats
    ("Babu Ghat", "ghat", "Classic ghat with a Greek-style pavilion (1830)", "বাবুঘাট (১৮৩০)"),
    ("Outram Ghat", "ghat", "Riverside promenade near Eden Gardens", "আউটরাম ঘাট"),
    ("Ahiritola Ghat", "ghat", "North Kolkata ferry ghat", "আহিরীটোলা ঘাট"),
    ("Bagbazar Ghat", "ghat", "Historic ghat of Bagbazar", "বাগবাজার ঘাট"),
    ("Nimtala Ghat", "ghat", "Old burning ghat", "নিমতলা ঘাট"),
    ("Kumartuli Ghat", "ghat", "Ghat beside the potters' quarter", "কুমোরটুলি ঘাট"),
    ("Armenian Ghat", "ghat", "Ferry ghat (1734)", "আর্মেনিয়ান ঘাট"),
    ("Judges Ghat", "ghat", "Ghat near Prinsep Ghat", "জাজেস ঘাট"),
    ("Fairlie Ghat", "ghat", "Ferry ghat on Strand Road", "ফেয়ারলি ঘাট"),
    ("Shobhabazar Ghat", "ghat", "Ferry ghat at Shobhabazar", "শোভাবাজার ঘাট"),
    # ---- sports grounds
    ("Mohun Bagan Ground", "stadium", "Home ground of Mohun Bagan (Maidan)", "মোহনবাগান মাঠ"),
    ("East Bengal Ground", "stadium", "Home ground of East Bengal (Maidan)", "ইস্টবেঙ্গল মাঠ"),
    ("Mohammedan Sporting Ground", "stadium", "Mohammedan Sporting club ground", "মহমেডান স্পোর্টিং মাঠ"),
    ("Netaji Indoor Stadium", "stadium", "Indoor arena near Eden Gardens", "নেতাজি ইন্ডোর স্টেডিয়াম"),
    ("Kishore Bharati Krirangan", "stadium", "Football stadium in Jadavpur", "কিশোর ভারতী ক্রীড়াঙ্গন"),
    ("Rabindra Sarobar Stadium", "stadium", "Stadium at Rabindra Sarobar", "রবীন্দ্র সরোবর স্টেডিয়াম"),
    ("Royal Calcutta Golf Club", "stadium", "Oldest golf club outside Britain (1829)", "রয়্যাল ক্যালকাটা গল্ফ ক্লাব (১৮২৯)"),
    ("Tollygunge Club", "stadium", "Historic club & golf course", "টালিগঞ্জ ক্লাব"),
    ("Calcutta Race Course", "stadium", "Horse racing course on the Maidan", "কলকাতা রেসকোর্স"),
]

ALIASES = {
    "Kalighat Kali Temple": ["Kalighat Temple", "Kalighat Kali Mandir", "Kalighat Mandir", "Kalighat Kalibari"],
    "ISKCON": ["ISKCON Kolkata", "ISKCON Temple", "Sri Sri Radha Govinda"], "Pareshnath Jain Temple": ["Pareshnath Temple", "Calcutta Jain Temple", "Sitambar Jain Temple"],
    "South City Mall": ["South City"], "Acropolis Mall": ["Acropolis"], "Gariahat Market": ["Gariahat"], "Hatibagan Market": ["Hatibagan"],
    "Mallick Ghat Flower Market": ["Mallick Ghat", "Mullick Ghat Flower Market", "Jagannath Ghat Flower Market"], "Kumartuli": ["Kumortuli", "Kumartuli Park"],
    "Rabindra Sarobar": ["Rabindra Sarovar", "Dhakuria Lake"], "Rabindra Sarobar Stadium": ["Rabindra Sarovar Stadium"],
    "Royal Calcutta Golf Club": ["Royal Calcutta Golf Course", "RCGC"], "Calcutta Race Course": ["Royal Calcutta Turf Club", "Kolkata Race Course", "Race Course"],
    "Kishore Bharati Krirangan": ["Kishore Bharati Stadium"], "K.C. Das": ["KC Das", "K C Das"], "Bhim Chandra Nag": ["Bhim Nag"],
    "Girish Chandra Dey & Nakur Chandra Nandy": ["Nakur", "Girish Chandra Dey"], "Royal Indian Hotel": ["Royal Indian"], "Chung Wah": ["Chung Wah Restaurant"],
    "Lake Kalibari": ["Lake Kali Bari", "Lake Kalibari Temple"], "Kumartuli Ghat": ["Kumortuli Ghat"], "Judges Ghat": ["Judge's Ghat", "Judges' Ghat"],
    "Chatterjee International Centre": ["Chatterjee International"], "Tollygunge Club": ["Tolly Club", "Tollygunge Golf Club"],
    "Urbana": ["Urbana Towers", "Urbana Tower"], "Ganguram": ["Ganguram's", "Ganguram Sweets"], "Golbari": ["Golbari Restaurant"],
}

S, W, N, E = 22.535, 88.280, 22.700, 88.490
src = sys.argv[1] if len(sys.argv) > 1 else "osm_raw"
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower().replace("&", "and").replace("'s", "s"))

osm = {}
for fn in sorted(glob.glob(os.path.join(src, "cell_*.json"))):
    for e in json.load(open(fn))["elements"]:
        t = e.get("tags", {})
        for key in ("name", "name:en", "alt_name", "old_name"):
            n = t.get(key)
            if not n:
                continue
            if e["type"] == "node":
                lat, lon = e["lat"], e["lon"]
            else:
                g = e.get("geometry") or [q for m in e.get("members", []) for q in (m.get("geometry") or [])]
                g = [q for q in g if q]
                if not g:
                    continue
                lat, lon = sum(q["lat"] for q in g) / len(g), sum(q["lon"] for q in g) / len(g)
            if S <= lat <= N and W <= lon <= E:
                osm.setdefault(norm(n), (lat, lon, t))
wd = json.load(open(os.path.join(src, "wikidata.json"))) if os.path.exists(os.path.join(src, "wikidata.json")) else []
wdn = {}
for it in wd:
    if it.get("en"):
        wdn.setdefault(norm(it["en"]), it)


def nominatim(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": 1, "viewbox": f"{W},{N},{E},{S}", "bounded": 1})
    req = urllib.request.Request(url, headers={"User-Agent": "KolkataCity3D-builder/1.0 (open-source game map builder)"})
    time.sleep(1.1)
    try:
        r = json.load(urllib.request.urlopen(req, timeout=30))
        return (float(r[0]["lat"]), float(r[0]["lon"])) if r else None
    except Exception:
        return None


out, missing = [], []
for row in FAMOUS:
    name, kind, en, bn = row[:4]
    k = norm(name)
    keys = [k] + [norm(a) for a in ALIASES.get(name, [])]
    hit = it = None
    for kq in keys:
        hit = hit or osm.get(kq) or next((v for kk, v in osm.items() if len(kq) > 6 and (kk.startswith(kq) or (len(kq) > 9 and kq in kk))), None)
        it = it or wdn.get(kq) or next((v for kk, v in wdn.items() if len(kq) > 6 and (kk.startswith(kq) or (len(kq) > 9 and kq in kk))), None)
    o = {"key": k, "en": name, "kind": kind, "desc": en, "bndesc": bn}
    if hit:
        o.update(lat=hit[0], lon=hit[1], src="osm")
        if hit[2].get("name:bn"):
            o["bn"] = hit[2]["name:bn"]
    elif it:
        o.update(lat=it["lat"], lon=it["lon"], src="wikidata")
    else:
        ll = nominatim(row[4] if len(row) > 4 else name + ", Kolkata")
        if ll:
            o.update(lat=ll[0], lon=ll[1], src="nominatim")
    if it:
        if it.get("img"):
            o["img"] = it["img"]
        if it.get("bn") and "bn" not in o:
            o["bn"] = it["bn"]
        o["q"] = it["q"]
    if "lat" in o:
        out.append(o)
    else:
        missing.append(name)
json.dump(out, open(os.path.join(src, "famous.json"), "w"), ensure_ascii=False, indent=0)
print("famous resolved", len(out), "of", len(FAMOUS), "| by", {s: sum(1 for o in out if o["src"] == s) for s in ("osm", "wikidata", "nominatim")})
print("not found:", missing)
