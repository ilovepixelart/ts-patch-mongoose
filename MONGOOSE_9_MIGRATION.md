# Mongoose 9 Migration Plan

## Overview
This document outlines the migration plan for supporting Mongoose 9 in ts-patch-mongoose based on the official [Mongoose 9 Migration Guide](https://mongoosejs.com/docs/migrating_to_9.html).

## Key Changes in Mongoose 9

### 1. Breaking Changes

#### 1.1 MongoDB Driver Update
- Mongoose 9 uses MongoDB Node driver v7.x (up from v6.x in Mongoose 8)
- The driver has its own breaking changes that may affect low-level operations

#### 1.2 Removed Deprecated Methods
- `Model.remove()` - Already handled in our codebase (removed in Mongoose 7)
- `Query.prototype.exec()` callback support - We use promises throughout
- `Document.prototype.$ignore()` - Not used in our codebase

#### 1.3 Schema Options Changes
- `strictQuery` is now `true` by default (was `false` in Mongoose 6)
- We already handle this in `src/version.ts` for Mongoose 6

#### 1.4 Query Middleware Changes
- Query middleware signature changes (if any)
- Update/delete hooks behavior

#### 1.5 Type System Updates
- TypeScript type definitions may have changed
- Stricter typing in some areas

### 2. Code Areas to Review

#### 2.1 Version Detection (`src/version.ts`)
- Add `isMongooseLessThan9` check
- Add `isMongoose9OrGreater` check
- Consider removing Mongoose 6-specific code if dropping support

#### 2.2 Hook Implementation
- `src/hooks/save-hooks.ts` - Verify save hooks still work
- `src/hooks/update-hooks.ts` - Check update/upsert behavior
- `src/hooks/delete-hooks.ts` - Verify delete hooks still work
- `src/index.ts` - Check insertMany and document delete hooks

#### 2.3 Query API
- Cursor operations (`cursor.eachAsync`)
- Query methods and options
- Lean query behavior

#### 2.4 Model Operations
- `findById`, `findOne`, `find` with lean()
- `countDocuments`
- `updateOne`, `updateMany`, etc.

### 3. Testing Strategy

#### 3.1 Compatibility Testing
Test with multiple Mongoose versions:
- Mongoose 6.6.x (minimum supported)
- Mongoose 7.x
- Mongoose 8.x
- Mongoose 9.x

#### 3.2 Test Areas
- [ ] Save hooks (create new documents)
- [ ] Update hooks (modify existing documents)
- [ ] Delete hooks (remove documents)
- [ ] Patch history creation
- [ ] Event emission
- [ ] TTL index management
- [ ] Omit fields functionality
- [ ] Pre-hooks (preSave, preDelete)
- [ ] Custom getUser, getReason, getMetadata

### 4. Package Updates

#### 4.1 package.json Changes
```json
{
  "peerDependencies": {
    "mongoose": ">=6.6.0 < 10"  // Changed from ">=6.6.0 < 9"
  },
  "devDependencies": {
    "mongoose": "9.0.0"  // Update to test with Mongoose 9
  }
}
```

#### 4.2 Type Dependencies
- Verify `@types/node` compatibility
- Check if any Mongoose type imports need updating

### 5. Documentation Updates

#### 5.1 README.md
Update supported versions section:
```json
{
  "node": "18.x || 20.x || 22.x",
  "mongoose": ">=6.6.x || 7.x || 8.x || 9.x"
}
```

Add installation instructions for Mongoose 9:
```bash
# For latest mongoose 9
npm install mongoose@9
pnpm add mongoose@9
yarn add mongoose@9
bun add mongoose@9
```

#### 5.2 CHANGELOG.md
Add entry for Mongoose 9 support.

### 6. Potential Issues & Solutions

#### 6.1 Cursor API Changes
If `cursor.eachAsync` changes or is deprecated:
- Check Mongoose 9 docs for recommended approach
- Update `src/hooks/update-hooks.ts` line 72-76

#### 6.2 Hook Timing Changes
If hook execution order changes:
- Verify pre/post hook behavior
- Test with actual database operations

#### 6.3 Type Compatibility
If TypeScript types are incompatible:
- Update type imports
- Add conditional types based on Mongoose version
- Use type assertions where necessary

#### 6.4 MongoDB Driver Changes
If low-level driver operations change:
- Review `src/helpers.ts` index operations
- Check collection.indexes() return format
- Verify createIndex and dropIndex methods

### 7. Implementation Steps

#### Phase 1: Preparation
1. [x] Create migration plan document
2. [ ] Research Mongoose 9 changelog
3. [ ] Identify potential breaking changes
4. [ ] Review all hooks and queries

#### Phase 2: Code Updates
1. [ ] Update `src/version.ts` with Mongoose 9 detection
2. [ ] Update type imports if needed
3. [ ] Add version-specific code branches if required
4. [ ] Update hook implementations if needed

#### Phase 3: Testing
1. [ ] Update devDependency to Mongoose 9
2. [ ] Run full test suite
3. [ ] Fix any failing tests
4. [ ] Test with Mongoose 6, 7, 8, and 9

#### Phase 4: Documentation & Release
1. [ ] Update README.md
2. [ ] Update package.json peer dependencies
3. [ ] Update CHANGELOG.md
4. [ ] Create release notes

### 8. Backward Compatibility

The library will maintain backward compatibility with:
- Mongoose 6.6.0+
- Mongoose 7.x
- Mongoose 8.x

Version detection in `src/version.ts` ensures appropriate code paths are used for each version.

### 9. Risk Assessment

**Low Risk:**
- Version detection updates
- Documentation updates
- Peer dependency range updates

**Medium Risk:**
- Hook behavior changes
- Query API changes
- Type compatibility

**High Risk:**
- Fundamental MongoDB driver changes
- Breaking changes in cursor API
- Schema options that affect plugin behavior

### 10. Rollback Plan

If critical issues are discovered:
1. Keep peer dependency at `>=6.6.0 < 9`
2. Document known issues with Mongoose 9
3. Plan for a future major version that requires Mongoose 9+

### 11. References

- [Mongoose 9 Migration Guide](https://mongoosejs.com/docs/migrating_to_9.html)
- [Mongoose 9 Changelog](https://github.com/Automattic/mongoose/blob/master/CHANGELOG.md)
- [MongoDB Node Driver 7.x Changelog](https://github.com/mongodb/node-mongodb-native/releases)
