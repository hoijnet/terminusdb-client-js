/**
 * Integration tests for WOQL select() with empty variable list
 * 
 * Tests that select() with no arguments is valid and works correctly.
 * This is needed for patterns like localize() where we want to hide
 * all inner variables while still executing the inner query.
 */
import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import { createTestClient, setupTestDatabase } from './test_utils';

const WOQL = require('../lib/woql');

describe('WOQL select() with empty variable list', () => {
  const dbName = 'db__test_select_empty';
  const client = createTestClient();

  beforeAll(async () => {
    client.db(dbName);
    await setupTestDatabase(client, dbName, {
      comment: 'Database for testing select() with empty variable list',
    });
  });

  afterAll(async () => {
    try {
      await client.deleteDatabase(dbName);
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  test('select() with no arguments should be valid and return empty bindings', async () => {
    // select() with no arguments should:
    // 1. Be valid syntax (not throw client-side error)
    // 2. Execute successfully on server
    // 3. Return bindings with no variables (empty objects)
    
    const query = WOQL.select().and(
      WOQL.eq('v:X', WOQL.string('test'))
    );

    const result = await client.query(query);
    
    expect(result).toBeDefined();
    expect(result.bindings).toBeDefined();
    expect(result.bindings.length).toBe(1);
    
    // The binding should be empty since select() hides all variables
    const binding = result.bindings[0];
    expect(Object.keys(binding).length).toBe(0);
  });

  test('select() should hide inner variables while outer variables remain visible', async () => {
    // Pattern: outer variable is visible, inner variables are hidden by select()
    const query = WOQL.and(
      WOQL.eq('v:Outer', WOQL.string('visible')),
      WOQL.select().and(
        WOQL.eq('v:Inner', WOQL.string('hidden')),
        // Use both variables to ensure query executes
        WOQL.eq('v:Both', 'v:Inner'),
      ),
    );

    const result = await client.query(query);
    
    expect(result).toBeDefined();
    expect(result.bindings).toBeDefined();
    expect(result.bindings.length).toBe(1);
    
    const binding = result.bindings[0];
    
    // v:Outer should be visible (defined outside select())
    const outer = binding['Outer'] || binding['v:Outer'];
    expect(outer).toBeDefined();
    expect(outer['@value']).toBe('visible');
    
    // v:Inner and v:Both should NOT be visible (inside select())
    expect(binding['Inner']).toBeUndefined();
    expect(binding['v:Inner']).toBeUndefined();
    expect(binding['Both']).toBeUndefined();
    expect(binding['v:Both']).toBeUndefined();
  });

  test('select() should hide inner variables but allow outer variables to be bound', async () => {
    // Pattern: outer variable is visible, inner variables are hidden by select()
    // Outer variable gets a value, setting the outer variable by equalling it to itself
    const query = WOQL.and(
      WOQL.eq('v:Outer', 'v:Outer'),
      WOQL.select().and(
        WOQL.eq('v:Inner', WOQL.string('hidden')),
        WOQL.eq('v:Inner-Shared-Value', WOQL.string('visible')),
        // Use both variables to ensure query executes
        WOQL.eq('v:Outer', 'v:Inner-Shared-Value'),
      ),
    );

    const result = await client.query(query);
    
    expect(result).toBeDefined();
    expect(result.bindings).toBeDefined();
    expect(result.bindings.length).toBe(1);
    
    const binding = result.bindings[0];
    
    // v:Outer should be visible (defined outside select())
    const outer = binding['Outer'] || binding['v:Outer'];
    expect(outer).toBeDefined();
    expect(outer['@value']).toBe('visible');
    
    // v:Inner and v:Both should NOT be visible (inside select())
    expect(binding['Inner']).toBeUndefined();
    expect(binding['v:Inner']).toBeUndefined();
    expect(binding['Both']).toBeUndefined();
    expect(binding['v:Both']).toBeUndefined();
  });

  test('select() generated JSON should have empty variables array', () => {
    // Verify the WOQL builder generates correct JSON with empty variables array
    const query = WOQL.select().and(
      WOQL.eq('v:X', WOQL.string('test'))
    );
    
    const json = query.json();
    
    expect(json['@type']).toBe('Select');
    expect(json.variables).toBeDefined();
    expect(Array.isArray(json.variables)).toBe(true);
    expect(json.variables.length).toBe(0);
  });

  test('two localized blocks can bind same variable name to different values', async () => {
    // KEY TEST: Demonstrates select() scope isolation
    // Two separate localized blocks use the same internal variable name (v:temp)
    // but bind it to different values - proving they don't interfere
    
    const [localized1, v1] = WOQL.localize({
      result: 'v:result1',
      temp: null,  // local variable - same name in both blocks
    });
    
    const [localized2, v2] = WOQL.localize({
      result: 'v:result2', 
      temp: null,  // local variable - same name, different scope
    });
    
    const query = WOQL.and(
      // First localized block: temp = "first", result1 = temp
      localized1(
        WOQL.and(
          WOQL.eq(v1.temp, WOQL.string('first')),
          WOQL.eq(v1.result, v1.temp),
        )
      ),
      // Second localized block: temp = "second", result2 = temp  
      localized2(
        WOQL.and(
          WOQL.eq(v2.temp, WOQL.string('second')),
          WOQL.eq(v2.result, v2.temp),
        )
      ),
    );

    const result = await client.query(query);
    
    expect(result).toBeDefined();
    expect(result.bindings).toBeDefined();
    expect(result.bindings.length).toBe(1);
    
    const binding = result.bindings[0];
    
    // v:result1 should be "first" (from first localized block)
    const result1 = binding['result1'] || binding['v:result1'];
    expect(result1).toBeDefined();
    expect(result1['@value']).toBe('first');
    
    // v:result2 should be "second" (from second localized block)
    const result2 = binding['result2'] || binding['v:result2'];
    expect(result2).toBeDefined();
    expect(result2['@value']).toBe('second');
    
    // The temp variables should NOT be visible (they're local)
    expect(binding['temp']).toBeUndefined();
    expect(binding['v:temp']).toBeUndefined();
  });

  test('localize pattern: select() hides local variables, eq() exposes outer params', async () => {
    // This is the real use case: localize() pattern
    // - Outer parameters are bound via eq() OUTSIDE select()
    // - Local variables are hidden by select()
    
    // Simulate what localize() should do with select() (not select(''))
    const outerParam = 'v:param_unique_123';
    const localVar = 'v:local_unique_456';
    
    const query = WOQL.and(
      // Outer eq() bindings - these should be visible
      WOQL.eq('v:MyParam', outerParam),
      
      // select() with no args - hides everything inside
      WOQL.select().and(
        // Bind the unique param to a value
        WOQL.eq(outerParam, WOQL.string('param_value')),
        // Use a local variable (should be hidden)
        WOQL.eq(localVar, WOQL.string('local_value')),
      ),
    );

    const result = await client.query(query);
    
    expect(result).toBeDefined();
    expect(result.bindings).toBeDefined();
    expect(result.bindings.length).toBe(1);
    
    const binding = result.bindings[0];
    
    // v:MyParam should be visible (eq() is outside select())
    // and unified with outerParam which was bound inside
    const myParam = binding['MyParam'] || binding['v:MyParam'];
    expect(myParam).toBeDefined();
    expect(myParam['@value']).toBe('param_value');
  });
});
