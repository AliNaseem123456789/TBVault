// Plausible brands per category, for demo data. Keys are lower-case category names;
// DummyJSON slugs ("mens-shirts") are matched as "mens shirts".
export const BRANDS_BY_CATEGORY = {
    audio: ["Sony", "Bose", "JBL", "Sennheiser", "Anker Soundcore"],
    accessories: ["Anker", "Belkin", "Spigen", "Bellroy", "Fossil"],
    home: ["IKEA", "Muji", "Brabantia", "Joseph Joseph", "Habitat"],
    wearables: ["Garmin", "Fitbit", "Apple", "Samsung", "Amazfit"],
    beauty: ["Essence", "Maybelline", "L'Oréal", "NYX", "Revlon"],
    fragrances: ["Chanel", "Dior", "Calvin Klein", "Gucci", "Versace"],
    furniture: ["IKEA", "Herman Miller", "West Elm", "Habitat", "Muuto"],
    groceries: ["Nestlé", "Kellogg's", "Heinz", "Tropicana", "Dole"],
    "home decoration": ["H&M Home", "Zara Home", "Umbra", "Muji", "IKEA"],
    "kitchen accessories": ["OXO", "Joseph Joseph", "Tefal", "KitchenAid", "Le Creuset"],
    laptops: ["Apple", "Dell", "Lenovo", "HP", "Asus"],
    "mens shirts": ["Uniqlo", "Levi's", "Ralph Lauren", "Tommy Hilfiger", "H&M"],
    "mens shoes": ["Nike", "Adidas", "Clarks", "Vans", "New Balance"],
    "mens watches": ["Casio", "Seiko", "Fossil", "Citizen", "Tissot"],
    "mobile accessories": ["Anker", "Belkin", "Spigen", "Apple", "Samsung"],
    motorcycle: ["Honda", "Yamaha", "Kawasaki", "Suzuki", "Ducati"],
    "skin care": ["CeraVe", "The Ordinary", "Neutrogena", "Olay", "La Roche-Posay"],
    smartphones: ["Apple", "Samsung", "Google", "OnePlus", "Xiaomi"],
    "sports accessories": ["Nike", "Adidas", "Wilson", "Under Armour", "Puma"],
    sunglasses: ["Ray-Ban", "Oakley", "Persol", "Maui Jim", "Prada"],
    tablets: ["Apple", "Samsung", "Lenovo", "Amazon", "Microsoft"],
    tops: ["Zara", "H&M", "Mango", "Uniqlo", "Gap"],
    vehicle: ["Toyota", "Honda", "Ford", "Tesla", "Hyundai"],
    "womens bags": ["Michael Kors", "Coach", "Kate Spade", "Fossil", "Guess"],
    "womens dresses": ["Zara", "Mango", "H&M", "& Other Stories", "Reformation"],
    "womens jewellery": ["Pandora", "Swarovski", "Tiffany & Co.", "Mejuri", "Monica Vinader"],
    "womens shoes": ["Steve Madden", "Nine West", "Sam Edelman", "Converse", "Birkenstock"],
    "womens watches": ["Michael Kors", "Fossil", "Daniel Wellington", "Olivia Burton", "Casio"],
}
const FALLBACK = ["Northwind", "Everyday Co.", "Hollow Pine", "Brightline", "Studio Nine"]

const key = (categoryName) => String(categoryName ?? "").toLowerCase().replace(/-/g, " ").trim()

/** A brand for a product, stable for the same product id (so re-running gives the same answer). */
export const pickBrand = (categoryName, productId) => {
    const options = BRANDS_BY_CATEGORY[key(categoryName)] ?? FALLBACK
    return options[Math.abs(Number(productId) || 0) % options.length]
}

/** Finds or creates a brand by name; caches ids for the run. */
const ids = new Map()
export const brandId = async (prisma, name) => {
    const clean = String(name).trim().slice(0, 100)
    if (!ids.has(clean)) {
        const brand = await prisma.brand.upsert({ where: { name: clean }, update: {}, create: { name: clean } })
        ids.set(clean, brand.id)
    }
    return ids.get(clean)
}
