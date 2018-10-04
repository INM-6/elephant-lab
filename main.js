require.config({
  paths: {
      d3: '//cdnjs.cloudflare.com/ajax/libs/d3/3.5.17/d3.min'
  }
});
define(['base/js/namespace', 'jquery', 'require', 'd3'], 
	function(Jupyter, requirejs, d3){
    		var load_css = function() {
			//$('#site').css({width: '70%'});
			console.log("HEEEERE");
        		var link = document.createElement("link");
        		link.type = "text/css";
        		link.rel = "stylesheet";
        		link.href = require.toUrl("/nbextensions/new_ext/new_main.css");
        		document.getElementsByTagName("head")[0].appendChild(link);
			console.log("HEREEEEEE");
			console.log(link);
			$("body").append('<div><div id="content" style="display:inline-block;width=30%;"><p>Text</p></div></div>');
			$.get("/nbextensions/new_ext/new_main.html", function (data) {$("#content").append(data);console.log("A "+ data);});
			//$('#content').load("./../nbextensions/new_ext/new_main.html", function( response, status, xhr ) {console.log(xhr.statusText + " " +response);});
    		};

		var showd3 = function(d3){
			console.log("D3 "+d3.version);
			var data = [150, 230, 180, 90];
 
			var svg = d3.select("#content")
            		.append("svg")
            		.attr("width", 300)
            		.attr("height", 200);
 			svg.selectAll(".bar")
				.data(data)
  				.enter()
  				.append("rect")
  				.attr({
    					class : "bar",
    					width : function(d) {return d;},
    					height: "40",
    					y : function(d, i) {return i*50 + 10;},
    					x : "10"
   				});
			console.log("D3 finished");
		};
		var updateplot = function(d3){
			//require.config({
			 // paths: {
			 //     d3: '//cdnjs.cloudflare.com/ajax/libs/d3/3.4.8/d3.min'
			 // }
			//});
			//require(["d3"], function(d3) {console.log("D3 loaded: "+d3.version);});
			console.log("D3 "+d3.version);
			var data = [10, 100, 190];
 
			var svg = d3.select("#content");
 			var bars = svg.selectAll(".bar")
				.data(data);
			//bars.attr("class", "update");
			// Remove unnecessary bars if data became less
  			bars.exit().remove();
			// Add new bars that might be needed additionally
			bars.enter()
  				.append("rect")
  				.attr({
    					class : "bar",
    					width : function(d) {return d;},
    					height: "40",
    					y : function(d, i) {return i*50 + 10;},
    					x : "10"
   				});
				//.merge(bars)
				//	.data(function(d){return d;});
			bars.transition()
				.duration(0)
				// Update all attributes
  				.attr({
    					class : "bar",
    					width : function(d) {return d;},
    					height: "40",
    					y : function(d, i) {return i*50 + 10;},
    					x : "10"
   				});
			console.log("D3 finished");
		};

		/*var updateplot = function(d3){
			var data = [10, 100, 10, 100];
			var svg = d3.select("#content").transition();
			svg.selectAll(".bar")
				.data(data)
				.enter();
		};*/

		function init_py(){
			var src = Jupyter.notebook.base_url + "nbextensions/new_ext/test.py"
			$.get(src)
				.done(function(data){
					Jupyter.notebook.kernel.execute(data);
					console.log("Loading Python finished:");
				})
				.fail(function(){
					console.log("Loading Python failed:");
				});
		}

		function show_res(data){
			console.log(data);
			var d = JSON.parse(data.content.text.trim());
			console.log(d);
			/*if(d.length > 1){
				Jupyter.notebook.kernel.execute('del ' + d[0]);
				Jupyter.notebook.kernel.execute('blchidx0.analogsignals.append(blchidx1.analogsignals[0])');
			}*/
			res = [];
			d.forEach(function(elem){
				res.push("<p>"+elem+"</p>");
			});
			$("#new_content").html(res.join(' '));
			console.log("AAA");
		}
		function update(kernel){
			Jupyter.notebook.kernel.execute('print(testfunc())', {iopub: {output: show_res}});
		}


		function load_ipython_extension(){
			load_css();
			init_py();
			console.log("Before");
			require(["d3"], showd3);
			console.log("After");
			//load_css();
			//update(Jupyter.notebook.kernel);
			//events.on('execute.CodeCell', update); 
			//alert("Hello World!");
			var handler = function(){
				alert("GHI");
			};

			var action = {
				icon: 'fa-comments-o',
				help: ' Show alert',
				handler: handler
			};

			var full_action_name = Jupyter.actions.register(action, 'ghi', 'new_ext');
			Jupyter.toolbar.add_buttons_group([full_action_name]);

			var handler_del = function(){
				Jupyter.notebook.kernel.execute('del data');
				update();
			}
			var action_del = {
				icon: 'fa-window-close-o',
				help: 'Delete data',
				handler: handler_del
			}
			var full_action_name_del = Jupyter.actions.register(action_del, 'del', 'new_ext');
			Jupyter.toolbar.add_buttons_group([full_action_name_del]);
			
			var code_exec_callback = function(msg){
				var d = JSON.parse(msg.content.text.trim());
				//alert(d);
				console.log("Callback: " + d);
			};

			//var cmd = 'print(json.dumps("abc"))';
			//Jupyter.notebook.kernel.execute(cmd, { iopub: { output: code_exec_callback } }, { silent: false });
			
			update(Jupyter.notebook.kernel);
			Jupyter.notebook.events.on('execute.CodeCell', update);
			Jupyter.notebook.events.on('execute.CodeCell', function(){require(["d3"], updateplot);});

			//console.log(Jupyter.notebook);
		}
		return {
			load_ipython_extension: load_ipython_extension
		};
	}
);
