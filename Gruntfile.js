'use strict';

module.exports = function(grunt) {

  // Project configuration.
  var pkg = grunt.file.readJSON('package.json');
  process.env['STRAPLESS_VERSION'] = grunt.option('tag') || undefined;
  grunt.initConfig({
    pkg: pkg,
    gitclone: {
      twbs: {
        // Clone the source repository (from key "meta-source-repository"):
        options: {
          repository: pkg["meta-source-repository"],
          directory: ".tmp"
        }
      }
    },

    // Copy files from temp repository into main location
    copy: {
      less: {
        files: [
          {
            expand: true,
            cwd: '.tmp/less',
            src: ['**/*.less'],
            dest: 'less/'
          }
        ]
      }
    },

    // Clean the temporary git repository
    clean: ['.tmp'],
  });

  // These plugins provide necessary tasks.
  grunt.loadNpmTasks('grunt-git');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-clean');

  // Check the origin repository for a more recent release
  grunt.registerTask('checkorigin', function() {
    var done = this.async(), tags,
    proc = grunt.util.spawn({
      cmd: 'git',
      args: ['ls-remote', '--tags', pkg["meta-source-repository"]]
    }, got_tags);
    function got_tags(err, result, code) {
      var text = result.stdout;
      var semvertag = /^([a-fA-F0-9]+)\s+refs\/tags\/v((\d+)\.(\d+)\.(\d+))$/;
      text = text.replace(/\r\n?/g, '\n');
      tags = (text.split('\n').map(function(tag) {
        var m = tag.match(semvertag);
        if(m === null)
          return undefined; 
        return {
          tagname: 'v'+m[2],
          commit: m[1],
          major: parseInt(m[3]),
          minor: parseInt(m[4]),
          patch: parseInt(m[5])
        };
      }));
      // Remove null keys from the array
      tags = grunt.util._.reject(tags, function(it) {
        return typeof it !== 'object';
      });

      // Sort each of these tags so that the most recent is at the head of the
      // list:
      tags.sort(function(a,b) {
        if(a.major !== b.major)
          return b.major - a.major;
        else if(a.minor !== b.minor)
          return b.minor - a.minor;
        else
          return b.patch - a.patch;
      });

      // If we've already got this tag in package.json, stop working
      var tag = [tags[0].major, tags[0].minor, tags[0].patch].join(".");
      if(pkg.version === tag) {
        //grunt.fail.fatal('Already up to date ('.green + tag.yellow + ')'.green);
      }

      // Print the most recent tag, and check it out
      grunt.verbose.writeln("Updating to tagged release: ".cyan + tag.green);
      // Tag this release
      process.env['STRAPLESS_VERSION'] = tag;
      process.env['STRAPLESS_COMMIT'] = tags[0].commit;

      // Get the description for the new tag
      done();
    }
  });

  // Checkout the latest semver-ish tag in the checked out directory
  grunt.registerTask('checkoutlatest', function() {
    var done = this.async();
    var start = process.cwd();
    process.chdir('.tmp');
    grunt.util.spawn({
      cmd: 'git',
      args: ['checkout', process.env['STRAPLESS_COMMIT']]
    }, checkedout);

    function checkedout(err, result, code) {
      process.chdir(start);
      if(err)
        return grunt.fail.fatal(err);
      done();
    }
  });

  // Update versions in bower.json and package.json
  grunt.registerTask('updatever', function() {
    if(typeof process.env['STRAPLESS_VERSION'] !== 'string' ||
       !/^v?\d+\.\d+\.\d+$/.test(process.env['STRAPLESS_VERSION'])) {
      return grunt.fail.fatal("version does not look like a valid semver version");
    }
    var pkg = grunt.file.readJSON('package.json'),
        bower = grunt.file.readJSON('bower.json'),
        ver = process.env['STRAPLESS_VERSION']
    if(ver.indexOf('v') === 0)
      ver = ver.substr(1);
    pkg.version = ver;
    bower.version = ver;
    // Write the changes...
    grunt.file.write('package.json', JSON.stringify(pkg, null, 2));
    grunt.file.write('bower.json', JSON.stringify(bower, null, 2));
  });

  // Commit the release
  grunt.registerTask('commit', function() {
    var done = this.async();
    if(!process.env['STRAPLESS_VERSION'])
      return grunt.fail.fatal("Missing version for tag name");
    
    var tag = 'v' + process.env['STRAPLESS_VERSION'];
    var message = "Synchronized with twbs/bootstrap#" + tag;

    console.log("COMMIT MESSAGE: '" + message + "'");

    // First, expand the files to be committed... This seems to be broken in grunt-git,
    // for whatever reason, so we'll reimplement it here
    var files = grunt.file.expand([
      '.gitignore',
      '.npmignore',
      'less/**/*.less',
      'package.json',
      'bower.json',
      'README.md',
      'Gruntfile.js'
    ]);

    grunt.util.async.forEach(files, function(file, next) {
      grunt.util.spawn({
        cmd: 'git',
        args: ['add', file]
      }, finished);
      function finished(err, result, code) {
        // Ignore errors
        next(null);
      }
    }, added);

    function added(err) {
      grunt.util.spawn({
        cmd: 'git',
        args: ['commit', '-m', message]
      }, commited);
    }

    function commited(err, result, code) {
      if(err)
        return grunt.fail.fatal(err);
      done();
    }
  });

  // Tag the release
  grunt.registerTask('gittag', function() {
    var done = this.async();
    if(!process.env['STRAPLESS_VERSION'])
      return grunt.fail.fatal("Missing version for tag name");
    
    var tag = 'v' + process.env['STRAPLESS_VERSION'];
    var message = "Synchronized with twbs/bootstrap#" + tag;
    
    grunt.util.spawn({
      cmd: 'git',
      args: ['tag', '-a', '-m', message, tag]
    }, tagged);

    function tagged(err, result, code) {
      if(err)
        return grunt.fail.fatal(err);
      done();
    }
  });


  // Push the committed code to 'origin'
  grunt.registerTask('gitpush', function() {
    if(!process.env['STRAPLESS_VERSION'])
      return grunt.fail.fatal("Missing version for tag name");
    var done = this.async();
    grunt.util.spawn({
      cmd: 'git',
      args: ['push', 'origin', 'master', 'v' + process.env['STRAPLESS_VERSION']]
    }, pushed);
    function pushed(err, result, code) {
      if(err)
        return grunt.fail.fatal(err);
      done();
    }
  });

  // Default task.
  grunt.registerTask('default', [
    'checkorigin',    // Check most recent release from origin
    'gitclone',       // Clone the source repository
    'checkoutlatest', // Checkout the latest semver-ish tag (release)
                      // (This will store the text for the latest release
                      // in a global variable, to be reused later)
    'clean',          // Copy the files into our nice directory
    'updatever',      // Update version info from repo's package.json/bower.json
    'clean',          // Delete the git repository
    'commit',         // Commit the updated files
    'gittag',         // Tag the current release
    'gitpush'         // Push changes to origin
  ]);
};
