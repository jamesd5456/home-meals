# Home Meals site

Standing rule for `data/shopping.json`: a shopping list holds only the ingredients the recipes in `data/recipes.json` use, in the exact amounts they need. No assumed staples, snacks, buffers or spare quantities. Add up the recipe ingredient lines for the meals scheduled in the list's window, and note the recipe beside each item. Where a recipe says "X or Y" use the one that needs no purchase, skip optional items, and where a pack can't be bought in the exact amount write "buy the smallest pack". If a week's recipes don't exist yet, leave its list empty.

Keep personal details (names, dates of birth, roster, health history) out of this public repo. Run `npm test` before pushing.
