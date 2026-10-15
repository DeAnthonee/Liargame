// Topic cards. Each card is a 4x4 grid of 16 words.
// Grid positions are read column-letter then row-number (A1 .. D4),
// row by row: words[0..3] = A1 B1 C1 D1, words[4..7] = A2 B2 C2 D2, etc.
(function (root) {
const TOPICS = [
  {
    name: "Food",
    words: [
      "Pizza", "Potatoes", "Fish", "Cake",
      "Pasta", "Salad", "Soup", "Bread",
      "Eggs", "Cheese", "Fruit", "Sausage",
      "Chicken", "Ice Cream", "Chocolate", "Beef"
    ]
  },
  {
    name: "Rooms",
    words: [
      "Kitchen", "Hallway", "Greenhouse", "Bedroom",
      "Bathroom", "Dining Room", "Office", "Living Room",
      "Attic", "Basement", "Dungeon", "Nursery",
      "Pantry", "Bunker", "Shed", "Garage"
    ]
  },
  {
    name: "Countries",
    words: [
      "UK", "Spain", "Japan", "Brazil",
      "France", "USA", "Italy", "Australia",
      "Germany", "Mexico", "India", "New Zealand",
      "Canada", "China", "Russia", "Egypt"
    ]
  },
  {
    name: "Celebrations",
    words: [
      "Christmas", "Father's Day", "St Patrick's Day", "Easter",
      "St George's Day", "April Fool's Day", "Boxing Day", "Valentine's Day",
      "Pancake Day", "Bonfire Night", "Queen's Jubilee", "Mother's Day",
      "New Year's Eve", "Burns Night", "May Day", "Halloween"
    ]
  },
  {
    name: "Sports Stars",
    words: [
      "Tiger Woods", "Tanni Grey-Thompson", "Michael Jordan", "David Beckham",
      "Michael Phelps", "Johanna Konta", "Muhammad Ali", "Kelly Holmes",
      "Bradley Wiggins", "Johnny Wilkinson", "Paula Radcliffe", "Jess Ennis-Hill",
      "Lewis Hamilton", "Maria Sharapova", "Usain Bolt", "Laura Trott"
    ]
  }
];
if (typeof module !== "undefined" && module.exports) module.exports = TOPICS; else root.TOPICS = TOPICS;
})(typeof window !== "undefined" ? window : globalThis);
